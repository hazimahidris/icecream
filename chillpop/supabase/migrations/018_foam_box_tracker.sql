-- ============================================================
-- Foam box tracker (/admin/inventory/foam-boxes).
--
-- foam_box_inventory and foam_box_rentals already exist in the base
-- schema (icecream_schema_v4.sql). Four RPCs back the tracker page:
--   - hand_out_foam_boxes  — creates the rental when staff hands
--     boxes over at pickup (the only thing that ever inserts into
--     foam_box_rentals)
--   - mark_foam_box_returned, mark_foam_box_lost,
--     refund_foam_box_deposit — lifecycle actions on an existing rental
--
-- deposit_outstanding on foam_box_inventory is a maintained running
-- counter (not computed live), kept in sync by every action below —
-- matches how available/rented/lost already work on that table.
-- ============================================================

-- Hand out boxes for an order once it's ready for pickup. due_date is
-- fulfilment_date + v_due_days — change that constant to adjust the
-- default rental period.
CREATE OR REPLACE FUNCTION hand_out_foam_boxes(
    p_order_id   UUID,
    p_addon_id   UUID,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_due_days       CONSTANT INT := 3;
    v_order          orders%ROWTYPE;
    v_qty            INT;
    v_available      INT;
    v_deposit_amount DECIMAL(10,2);
    v_deposit_paid   DECIMAL(10,2);
    v_rental_id      UUID;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF v_order.status <> 'ready' THEN
        RAISE EXCEPTION 'Boxes can only be handed out once the order is ready.';
    END IF;
    IF EXISTS (SELECT 1 FROM foam_box_rentals WHERE order_id = p_order_id) THEN
        RAISE EXCEPTION 'Foam boxes have already been handed out for this order.';
    END IF;

    SELECT COALESCE(SUM(qty), 0) INTO v_qty
    FROM order_items
    WHERE order_id = p_order_id AND addon_id = p_addon_id;

    IF v_qty <= 0 THEN
        RAISE EXCEPTION 'This order has no foam box rental to hand out.';
    END IF;

    SELECT available, deposit_amount
    INTO v_available, v_deposit_amount
    FROM foam_box_inventory
    JOIN addons ON addons.id = foam_box_inventory.addon_id
    WHERE foam_box_inventory.addon_id = p_addon_id
    FOR UPDATE OF foam_box_inventory;

    IF v_available IS NULL THEN
        RAISE EXCEPTION 'No inventory record for this addon.';
    END IF;
    IF v_available < v_qty THEN
        RAISE EXCEPTION 'Not enough foam boxes available (% available, % needed).', v_available, v_qty;
    END IF;

    v_deposit_paid := v_deposit_amount * v_qty;

    INSERT INTO foam_box_rentals (
        order_id, addon_id, qty, rented_at, due_date, deposit_paid, status, created_by
    ) VALUES (
        p_order_id, p_addon_id, v_qty, now(), v_order.fulfilment_date + v_due_days,
        v_deposit_paid, 'rented', p_created_by
    ) RETURNING id INTO v_rental_id;

    UPDATE foam_box_inventory
    SET available            = available - v_qty,
        rented               = rented + v_qty,
        deposit_outstanding  = deposit_outstanding + v_deposit_paid,
        last_updated         = now(),
        updated_by           = p_created_by
    WHERE addon_id = p_addon_id;

    RETURN v_rental_id;
END;
$$;

-- A rental row can be partially returned more than once — return_qty
-- accumulates across calls. deposit_outstanding is only released when
-- the rental fully closes out (status reaches 'returned'), not on
-- every partial call, so returning the same rental in two steps never
-- double-subtracts its deposit.
CREATE OR REPLACE FUNCTION mark_foam_box_returned(
    p_rental_id  UUID,
    p_return_qty INT,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_rental         foam_box_rentals%ROWTYPE;
    v_remaining      INT;
    v_new_return_qty INT;
    v_new_status     VARCHAR(20);
BEGIN
    SELECT * INTO v_rental FROM foam_box_rentals WHERE id = p_rental_id FOR UPDATE;

    IF v_rental.id IS NULL THEN
        RAISE EXCEPTION 'Rental not found.';
    END IF;
    IF v_rental.status NOT IN ('rented', 'overdue', 'partial_return') THEN
        RAISE EXCEPTION 'This rental is not active.';
    END IF;

    v_remaining := v_rental.qty - COALESCE(v_rental.return_qty, 0);
    IF p_return_qty IS NULL OR p_return_qty <= 0 OR p_return_qty > v_remaining THEN
        RAISE EXCEPTION 'Return quantity must be between 1 and %.', v_remaining;
    END IF;

    v_new_return_qty := COALESCE(v_rental.return_qty, 0) + p_return_qty;
    v_new_status := CASE WHEN v_new_return_qty >= v_rental.qty THEN 'returned' ELSE 'partial_return' END;

    UPDATE foam_box_rentals
    SET return_qty  = v_new_return_qty,
        status      = v_new_status,
        returned_at = CASE WHEN v_new_status = 'returned' THEN now() ELSE returned_at END,
        updated_at  = now(),
        updated_by  = p_created_by
    WHERE id = p_rental_id;

    UPDATE foam_box_inventory
    SET available           = available + p_return_qty,
        rented              = GREATEST(rented - p_return_qty, 0),
        deposit_outstanding = CASE
            WHEN v_new_status = 'returned'
            THEN GREATEST(deposit_outstanding - v_rental.deposit_paid, 0)
            ELSE deposit_outstanding
        END,
        last_updated = now(),
        updated_by   = p_created_by
    WHERE addon_id = v_rental.addon_id;

    RETURN p_rental_id;
END;
$$;

-- Marks whatever is still outstanding on the rental as lost. Deposit
-- is forfeited — deposit_outstanding is deliberately left untouched
-- (the business keeps holding that cash; nothing to refund).
CREATE OR REPLACE FUNCTION mark_foam_box_lost(
    p_rental_id  UUID,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_rental    foam_box_rentals%ROWTYPE;
    v_remaining INT;
BEGIN
    SELECT * INTO v_rental FROM foam_box_rentals WHERE id = p_rental_id FOR UPDATE;

    IF v_rental.id IS NULL THEN
        RAISE EXCEPTION 'Rental not found.';
    END IF;
    IF v_rental.status NOT IN ('rented', 'overdue', 'partial_return') THEN
        RAISE EXCEPTION 'This rental is not active.';
    END IF;

    v_remaining := v_rental.qty - COALESCE(v_rental.return_qty, 0);

    UPDATE foam_box_rentals
    SET status     = 'lost',
        updated_at = now(),
        updated_by = p_created_by
    WHERE id = p_rental_id;

    UPDATE foam_box_inventory
    SET lost         = lost + v_remaining,
        rented       = GREATEST(rented - v_remaining, 0),
        last_updated = now(),
        updated_by   = p_created_by
    WHERE addon_id = v_rental.addon_id;

    RETURN p_rental_id;
END;
$$;

-- Partial or full refund of a rental's deposit. Blocked once the
-- rental is 'lost' (deposit already forfeited).
CREATE OR REPLACE FUNCTION refund_foam_box_deposit(
    p_rental_id     UUID,
    p_refund_amount DECIMAL(10,2),
    p_created_by    VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_rental      foam_box_rentals%ROWTYPE;
    v_outstanding DECIMAL(10,2);
BEGIN
    SELECT * INTO v_rental FROM foam_box_rentals WHERE id = p_rental_id FOR UPDATE;

    IF v_rental.id IS NULL THEN
        RAISE EXCEPTION 'Rental not found.';
    END IF;
    IF v_rental.status = 'lost' THEN
        RAISE EXCEPTION 'Deposit is forfeited on a lost rental.';
    END IF;

    v_outstanding := v_rental.deposit_paid - COALESCE(v_rental.deposit_refunded, 0);
    IF p_refund_amount IS NULL OR p_refund_amount <= 0 OR p_refund_amount > v_outstanding THEN
        RAISE EXCEPTION 'Refund amount must be between 0 and %.', v_outstanding;
    END IF;

    UPDATE foam_box_rentals
    SET deposit_refunded = COALESCE(deposit_refunded, 0) + p_refund_amount,
        updated_at       = now(),
        updated_by       = p_created_by
    WHERE id = p_rental_id;

    UPDATE foam_box_inventory
    SET deposit_outstanding = GREATEST(deposit_outstanding - p_refund_amount, 0),
        last_updated        = now(),
        updated_by          = p_created_by
    WHERE addon_id = v_rental.addon_id;

    RETURN p_rental_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION hand_out_foam_boxes(UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_foam_box_returned(UUID, INT, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_foam_box_lost(UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_foam_box_deposit(UUID, DECIMAL, VARCHAR) FROM PUBLIC;
