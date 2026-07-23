-- ============================================================
-- Discounts engine — /admin/discounts, the order review step's promo
-- code + automatic bulk discount, and POS's promo code field.
--
-- discounts already exists in the base schema. Two things this adds:
--
-- 1. find_applicable_discount(code, cart_qty, subtotal) — the single
--    place that knows how to resolve "what discount applies right
--    now": the best matching bulk_qty tier, a promo code if one was
--    given, and which one wins when both are eligible (larger amount;
--    bulk wins ties, since it needed no customer action). Used by:
--      - the customer site (Step 4) for both the automatic bulk check
--        and the "Apply" promo button
--      - POS's promo code field
--      - place_order() itself, as the *authoritative* recomputation
--
--    It's SECURITY DEFINER and granted to anon/authenticated so the
--    public site can call it directly — but discounts itself gets NO
--    anon read policy. That's deliberate: a blanket "anon can read
--    discounts" policy would let anyone enumerate every promo code
--    (including ones not yet announced) just by querying the table.
--    Routing through this function means only a *matching* code's
--    result is ever exposed, never the list of valid codes.
--
-- 2. place_order() now recomputes the discount server-side instead of
--    trusting a client-submitted amount. place_order is the one RPC
--    in this project granted directly to anon (SECURITY DEFINER, no
--    admin auth in front of it) — trusting a client-supplied discount
--    amount there would let anyone hand-craft a call and give
--    themselves an arbitrary discount. The client now only sends
--    which promo code (if any) it wants tried; the function looks up
--    the real rule and computes the real amount itself.
-- ============================================================

CREATE OR REPLACE FUNCTION find_applicable_discount(
    p_code     VARCHAR(50),
    p_cart_qty INT,
    p_subtotal DECIMAL(12,2)
)
RETURNS TABLE (
    discount_id     UUID,
    discount_code   VARCHAR(50),
    discount_type   VARCHAR(20),
    discount_value  DECIMAL(10,2),
    discount_min_qty INT,
    discount_amount DECIMAL(12,2),
    source          VARCHAR(10),   -- 'promo' | 'bulk' | NULL (nothing applied)
    code_error      TEXT           -- set when p_code was given but invalid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bulk         discounts%ROWTYPE;
    v_bulk_amount  DECIMAL(12,2) := 0;
    v_promo        discounts%ROWTYPE;
    v_promo_amount DECIMAL(12,2) := 0;
    v_code_error   TEXT := NULL;
BEGIN
    -- Best matching automatic bulk-qty discount. bulk_qty's `value` is
    -- always a percentage (see /admin/discounts), and subtotal is the
    -- same for every candidate, so the highest `value` is always the
    -- highest amount — no need to compute every candidate's amount.
    SELECT * INTO v_bulk
    FROM discounts
    WHERE type = 'bulk_qty'
      AND is_active = true
      AND min_qty IS NOT NULL AND min_qty <= p_cart_qty
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_to   IS NULL OR valid_to   >= CURRENT_DATE)
    ORDER BY value DESC
    LIMIT 1;

    IF v_bulk.id IS NOT NULL THEN
        v_bulk_amount := LEAST(p_subtotal * (v_bulk.value / 100), p_subtotal);
    END IF;

    -- Promo code, if one was given. An invalid/expired/unmet code
    -- never blocks the order — it just doesn't apply (code_error is
    -- returned so the caller can show why), falling back to the bulk
    -- discount if one is still eligible.
    IF p_code IS NOT NULL AND TRIM(p_code) <> '' THEN
        SELECT * INTO v_promo
        FROM discounts
        WHERE code ILIKE TRIM(p_code) AND is_active = true
        LIMIT 1;

        IF v_promo.id IS NULL
           OR (v_promo.valid_from IS NOT NULL AND CURRENT_DATE < v_promo.valid_from)
           OR (v_promo.valid_to IS NOT NULL AND CURRENT_DATE > v_promo.valid_to)
           OR (v_promo.type = 'bulk_qty' AND COALESCE(v_promo.min_qty, 0) > p_cart_qty)
        THEN
            v_code_error := 'Code not found or expired';
            v_promo := NULL;
        ELSE
            v_promo_amount := CASE
                WHEN v_promo.type = 'flat' THEN LEAST(v_promo.value, p_subtotal)
                ELSE LEAST(p_subtotal * (v_promo.value / 100), p_subtotal)
            END;
        END IF;
    END IF;

    -- Only one discount per order. Larger wins; bulk wins ties.
    IF v_promo.id IS NOT NULL AND v_promo_amount > v_bulk_amount THEN
        RETURN QUERY SELECT
            v_promo.id, v_promo.code, v_promo.type, v_promo.value, v_promo.min_qty,
            v_promo_amount, 'promo'::VARCHAR(10), v_code_error;
    ELSIF v_bulk.id IS NOT NULL THEN
        RETURN QUERY SELECT
            v_bulk.id, v_bulk.code, v_bulk.type, v_bulk.value, v_bulk.min_qty,
            v_bulk_amount, 'bulk'::VARCHAR(10), v_code_error;
    ELSE
        RETURN QUERY SELECT
            NULL::UUID, NULL::VARCHAR(50), NULL::VARCHAR(20), NULL::DECIMAL(10,2), NULL::INT,
            0::DECIMAL(12,2), NULL::VARCHAR(10), v_code_error;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION find_applicable_discount(VARCHAR, INT, DECIMAL) TO anon, authenticated;

-- Old 12-param signature (no discount support) — must be dropped
-- explicitly since the new version has a different parameter count;
-- CREATE OR REPLACE only replaces a function with an identical signature.
DROP FUNCTION IF EXISTS place_order(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, DATE, TIME, TEXT, TEXT,
    DECIMAL, DECIMAL, JSONB, JSONB
);

CREATE OR REPLACE FUNCTION place_order(
    p_customer_name    VARCHAR(150),
    p_customer_phone   VARCHAR(30),
    p_customer_email   VARCHAR(150),
    p_fulfilment_type  VARCHAR(10),
    p_fulfilment_date  DATE,
    p_fulfilment_time  TIME,
    p_delivery_address TEXT,
    p_remarks          TEXT,
    p_subtotal         DECIMAL(12,2),
    p_deposit_required DECIMAL(12,2),
    p_items            JSONB DEFAULT '[]'::jsonb,
    p_addons           JSONB DEFAULT '[]'::jsonb,
    p_promo_code       VARCHAR(50) DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer_id  UUID;
    v_order_id     UUID;
    v_item         JSONB;
    v_available    DECIMAL;
    v_product_name VARCHAR;
    v_total_pcs    DECIMAL := 0;
    v_discount     RECORD;
    v_total        DECIMAL(12,2);
BEGIN
    -- 1. Re-check availability for every flavour before writing anything.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_available := available_stock(
            (v_item->>'product_id')::UUID,
            p_fulfilment_date
        );

        IF v_available < (v_item->>'qty')::DECIMAL THEN
            SELECT name INTO v_product_name
            FROM products WHERE id = (v_item->>'product_id')::UUID;

            RAISE EXCEPTION
                'Not enough stock for % on %. Only % available now.',
                COALESCE(v_product_name, 'this flavour'), p_fulfilment_date, v_available;
        END IF;

        v_total_pcs := v_total_pcs + (v_item->>'qty')::DECIMAL;
    END LOOP;

    -- 1b. Resolve the discount server-side — authoritative, ignores
    -- anything the client thinks the discount is.
    SELECT * INTO v_discount
    FROM find_applicable_discount(p_promo_code, v_total_pcs::INT, p_subtotal);

    v_total := p_subtotal - COALESCE(v_discount.discount_amount, 0);

    -- 2. Find or create the customer by phone. On a match, refresh
    -- name/email instead of leaving the existing row untouched.
    SELECT id INTO v_customer_id
    FROM customers
    WHERE phone = p_customer_phone
    LIMIT 1;

    IF v_customer_id IS NULL THEN
        INSERT INTO customers (name, phone, email, is_guest, created_by)
        VALUES (p_customer_name, p_customer_phone, p_customer_email, true, 'guest')
        RETURNING id INTO v_customer_id;
    ELSE
        UPDATE customers
        SET name  = p_customer_name,
            email = COALESCE(p_customer_email, email)
        WHERE id = v_customer_id;
    END IF;

    -- 3. Create the order.
    INSERT INTO orders (
        customer_id, channel, fulfilment_type, fulfilment_date, fulfilment_time,
        delivery_address, remarks, subtotal, discount_id, discount_amount, total,
        deposit_required, status, created_by, updated_by
    ) VALUES (
        v_customer_id, 'online', p_fulfilment_type, p_fulfilment_date, p_fulfilment_time,
        p_delivery_address, p_remarks, p_subtotal, v_discount.discount_id,
        COALESCE(v_discount.discount_amount, 0), v_total,
        p_deposit_required, 'awaiting_payment', 'customer', 'customer'
    ) RETURNING id INTO v_order_id;

    -- 4. Order line items — flavours.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO order_items (order_id, product_id, qty, unit_price, created_by)
        VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'qty')::DECIMAL,
            (v_item->>'unit_price')::DECIMAL,
            'customer'
        );
    END LOOP;

    -- 4b. Order line items — add-ons.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_addons)
    LOOP
        INSERT INTO order_items (order_id, addon_id, qty, unit_price, created_by)
        VALUES (
            v_order_id,
            (v_item->>'addon_id')::UUID,
            (v_item->>'qty')::DECIMAL,
            (v_item->>'unit_price')::DECIMAL,
            'customer'
        );
    END LOOP;

    -- 5. Reservations — pending, not confirmed. Stock is only actually
    -- locked once payment is verified (see CLAUDE.md core rule).
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO reservations (
            order_id, product_id, qty, needed_by, status, created_by, updated_by
        ) VALUES (
            v_order_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'qty')::DECIMAL,
            p_fulfilment_date,
            'pending',
            'customer',
            'customer'
        );
    END LOOP;

    RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION place_order(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, DATE, TIME, TEXT, TEXT,
    DECIMAL, DECIMAL, JSONB, JSONB, VARCHAR
) TO anon, authenticated;
