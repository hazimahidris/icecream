-- ============================================================
-- Fix: pos_checkout() double-counted every sale against
-- available_stock(). It both (a) directly decrements
-- product_stock.qty_on_hand and (b) inserted a reservation with
-- status = 'confirmed' — but available_stock() also subtracts
-- confirmed/in_production/ready reservations, so the same sale was
-- deducted twice (a 2-pc sale dropped availability by 4).
--
-- Diagnosed live: sold 2 pcs of Chocolate, qty_on_hand correctly
-- went 30 -> 28, but available_stock() reported 26.
--
-- Fix: POS reservations are now inserted as 'fulfilled' — the
-- schema's own status for "picked up / delivered", which an instant
-- POS sale is. available_stock() doesn't subtract 'fulfilled' rows,
-- so the direct stock deduction is the only thing affecting
-- availability, while the reservation row is kept for record-keeping
-- (matches order_items 1:1, useful for reporting later).
--
-- The customer-site flow (place_order / approve_payment_receipt)
-- never touches product_stock directly, so it was never affected —
-- this bug was isolated to POS.
-- ============================================================

CREATE OR REPLACE FUNCTION pos_checkout(
    p_items           JSONB, -- [{ "product_id": "...", "qty": 2, "unit_price": 5.00 }]
    p_payment_method  VARCHAR(30),
    p_subtotal        DECIMAL(12,2),
    p_discount_amount DECIMAL(12,2),
    p_discount_id     UUID,
    p_total           DECIMAL(12,2)
)
RETURNS TABLE (id UUID, order_number INT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order_id     UUID;
    v_item         JSONB;
    v_available    DECIMAL;
    v_product_name VARCHAR;
BEGIN
    -- 1. Final stock re-check, right before committing.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_available := available_stock(
            (v_item->>'product_id')::UUID,
            CURRENT_DATE
        );

        IF v_available < (v_item->>'qty')::DECIMAL THEN
            SELECT name INTO v_product_name
            FROM products WHERE products.id = (v_item->>'product_id')::UUID;

            RAISE EXCEPTION
                'Not enough stock for %. Only % available.',
                COALESCE(v_product_name, 'this flavour'), v_available;
        END IF;
    END LOOP;

    -- 1b. Discount still valid, if one was applied.
    IF p_discount_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM discounts WHERE discounts.id = p_discount_id AND is_active = true
        ) THEN
            RAISE EXCEPTION 'Discount is no longer valid.';
        END IF;
    END IF;

    -- 2. Order — 'completed' immediately, no deposit/pending window.
    INSERT INTO orders (
        channel, fulfilment_type, fulfilment_date, subtotal, discount_id,
        discount_amount, total, deposit_required, deposit_paid, status,
        payment_method, created_by, updated_by
    ) VALUES (
        'pos', 'pickup', CURRENT_DATE, p_subtotal, p_discount_id,
        p_discount_amount, p_total, p_total, p_total, 'completed',
        p_payment_method, 'pos', 'pos'
    ) RETURNING orders.id INTO v_order_id;

    -- 3. Order items, fulfilled reservations (record-keeping only —
    -- see note above on why not 'confirmed'), and immediate stock
    -- deduction — all three per line item.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO order_items (order_id, product_id, qty, unit_price, created_by)
        VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'qty')::DECIMAL,
            (v_item->>'unit_price')::DECIMAL,
            'pos'
        );

        INSERT INTO reservations (
            order_id, product_id, qty, needed_by, status, created_by, updated_by
        ) VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'qty')::DECIMAL,
            CURRENT_DATE,
            'fulfilled',
            'pos',
            'pos'
        );

        UPDATE product_stock
        SET qty_on_hand  = qty_on_hand - (v_item->>'qty')::DECIMAL,
            last_updated = now(),
            updated_by   = 'pos'
        WHERE product_id = (v_item->>'product_id')::UUID;
    END LOOP;

    RETURN QUERY SELECT orders.id, orders.order_number FROM orders WHERE orders.id = v_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION pos_checkout(JSONB, VARCHAR, DECIMAL, DECIMAL, UUID, DECIMAL) FROM PUBLIC;
