-- ============================================================
-- Adds orders.delivered_at — needed by the two new report pages
-- (/admin/reports/inventory and /admin/reports/operational) to know
-- precisely when an online order's stock was actually deducted /
-- when a booking was actually fulfilled.
--
-- Without this, the only timestamps on orders are created_at (when
-- placed) and updated_at (bumped by every status transition, so it
-- no longer reflects "delivered" once an order later moves to
-- 'completed'). delivered_at is set once, only by mark_order_fulfilled(),
-- and never touched again — a durable record of the handover moment.
--
-- Orders that were already 'delivered' or 'completed' before this
-- migration ran will have delivered_at = NULL forever — both new
-- report pages exclude those from anything delivered_at-dependent
-- and surface the excluded count rather than silently dropping them.
-- ============================================================

ALTER TABLE orders ADD COLUMN delivered_at TIMESTAMPTZ;

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
    SET status = 'delivered', delivered_at = now(), updated_at = now(), updated_by = p_created_by
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

REVOKE EXECUTE ON FUNCTION mark_order_fulfilled(UUID, VARCHAR) FROM PUBLIC;
