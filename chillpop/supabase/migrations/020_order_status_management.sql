-- ============================================================
-- Order status management (/admin/orders).
--
-- Drives orders through: booking_confirmed -> preparing -> ready ->
-- delivered -> completed, plus a cancel path from booking_confirmed.
-- Each transition is a single RPC that validates the order is
-- currently in the expected status before moving it, so two staff
-- clicking the same button twice (or an out-of-order click) fails
-- loudly instead of corrupting state.
--
-- order_refund_reviews is new — nothing in the schema previously
-- tracked "this deposit needs a manual refund." Cancelling a
-- booking_confirmed order with a paid deposit creates one row here;
-- no automatic refund happens (per spec, manual review only).
-- ============================================================

CREATE TABLE order_refund_reviews (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    deposit_paid DECIMAL(12,2) NOT NULL,
    reason       VARCHAR(100) NOT NULL DEFAULT 'order_cancelled',
    status       VARCHAR(20) NOT NULL DEFAULT 'pending_review'
                 CHECK (status IN ('pending_review', 'refunded', 'dismissed')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   VARCHAR(100) NOT NULL DEFAULT 'system'
);

ALTER TABLE order_refund_reviews ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION start_order_preparing(
    p_order_id   UUID,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_status VARCHAR(30);
BEGIN
    SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF v_status <> 'booking_confirmed' THEN
        RAISE EXCEPTION 'Order must be Booking Confirmed to start preparing (currently %).', v_status;
    END IF;

    UPDATE orders
    SET status = 'preparing', updated_at = now(), updated_by = p_created_by
    WHERE id = p_order_id;

    RETURN p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION mark_order_ready(
    p_order_id   UUID,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_status VARCHAR(30);
BEGIN
    SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF v_status <> 'preparing' THEN
        RAISE EXCEPTION 'Order must be Preparing to mark ready (currently %).', v_status;
    END IF;

    UPDATE orders
    SET status = 'ready', updated_at = now(), updated_by = p_created_by
    WHERE id = p_order_id;

    UPDATE reservations
    SET status = 'ready', updated_at = now(), updated_by = p_created_by
    WHERE order_id = p_order_id AND status IN ('confirmed', 'in_production');

    RETURN p_order_id;
END;
$$;

-- Covers both "Mark Delivered" (delivery orders) and "Mark Picked Up"
-- (pickup orders) — the schema only has one terminal status for both,
-- 'delivered', so the two buttons are the same action with different
-- labels client-side (driven by orders.fulfilment_type).
CREATE OR REPLACE FUNCTION mark_order_fulfilled(
    p_order_id   UUID,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_item  RECORD;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF v_order.status <> 'ready' THEN
        RAISE EXCEPTION 'Order must be Ready to mark delivered/picked up (currently %).', v_order.status;
    END IF;

    UPDATE orders
    SET status = 'delivered', updated_at = now(), updated_by = p_created_by
    WHERE id = p_order_id;

    UPDATE reservations
    SET status = 'fulfilled', updated_at = now(), updated_by = p_created_by
    WHERE order_id = p_order_id AND status = 'ready';

    -- pos_checkout() already deducts product_stock at the point of
    -- sale — only online advance orders still need it deducted here,
    -- at fulfilment time.
    IF v_order.channel = 'online' THEN
        FOR v_item IN
            SELECT product_id, qty FROM order_items
            WHERE order_id = p_order_id AND product_id IS NOT NULL
        LOOP
            UPDATE product_stock
            SET qty_on_hand  = qty_on_hand - v_item.qty,
                last_updated = now(),
                updated_by   = p_created_by
            WHERE product_id = v_item.product_id;
        END LOOP;
    END IF;

    RETURN p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION mark_order_completed(
    p_order_id   UUID,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_status VARCHAR(30);
BEGIN
    SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF v_status <> 'delivered' THEN
        RAISE EXCEPTION 'Order must be Delivered/Picked Up to mark completed (currently %).', v_status;
    END IF;

    UPDATE orders
    SET status = 'completed', updated_at = now(), updated_by = p_created_by
    WHERE id = p_order_id;

    RETURN p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_booking_confirmed_order(
    p_order_id   UUID,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order orders%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF v_order.status <> 'booking_confirmed' THEN
        RAISE EXCEPTION 'Only Booking Confirmed orders can be cancelled here (currently %).', v_order.status;
    END IF;

    UPDATE orders
    SET status = 'cancelled', updated_at = now(), updated_by = p_created_by
    WHERE id = p_order_id;

    -- Stock is "freed" simply by no longer being counted — available_stock()
    -- only ever subtracted confirmed/in_production/ready reservations, so
    -- moving them to 'cancelled' removes them from that count directly.
    UPDATE reservations
    SET status = 'cancelled', updated_at = now(), updated_by = p_created_by
    WHERE order_id = p_order_id AND status IN ('pending', 'confirmed', 'in_production', 'ready');

    IF v_order.deposit_paid > 0 THEN
        INSERT INTO order_refund_reviews (order_id, deposit_paid, reason, created_by)
        VALUES (p_order_id, v_order.deposit_paid, 'order_cancelled', p_created_by);
    END IF;

    RETURN p_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION start_order_preparing(UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_order_ready(UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_order_fulfilled(UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_order_completed(UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_booking_confirmed_order(UUID, VARCHAR) FROM PUBLIC;
