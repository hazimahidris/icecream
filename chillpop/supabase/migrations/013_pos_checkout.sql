-- ============================================================
-- POS checkout for /admin/pos.
--
-- Same reasoning as approve_payment_receipt: this instantly
-- deducts real product_stock and creates a 'completed' order —
-- more consequential than most anon-callable operations in this
-- project, not less. Called only from /api/admin/pos/checkout
-- using the service_role key; REVOKEd from PUBLIC so the anon key
-- can't call it directly and bypass the admin login.
--
-- Unlike place_order() (customer site), reservations here are
-- inserted as 'confirmed' immediately — POS payment is instant,
-- there's no pending/awaiting-payment window to model.
--
-- discount_id is re-checked for existence/active status at commit
-- time (not just trusted from the client), but the discount_amount
-- itself is trusted from the caller — it was already computed
-- authoritatively by /api/admin/pos/validate-promo (or is simple
-- cashier-entered RM/% arithmetic for a manual discount). POS staff
-- are already behind the admin login, so this is a light safeguard,
-- not full re-validation.
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

    -- 3. Order items, confirmed reservations, and immediate stock
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

        -- This is a POS sale, not a future booking — 'confirmed' directly,
        -- skipping the 'pending' state the customer-site flow uses.
        INSERT INTO reservations (
            order_id, product_id, qty, needed_by, status, created_by, updated_by
        ) VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'qty')::DECIMAL,
            CURRENT_DATE,
            'confirmed',
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
