-- ============================================================
-- Atomic order placement. Replaces the client-side sequence of
-- 5 separate inserts (customer -> order -> order_items ->
-- reservations) with a single SECURITY DEFINER function call.
--
-- Why: a Postgres function body runs inside one implicit
-- transaction. If the availability re-check fails, or any insert
-- errors partway through (e.g. order_items succeeds but
-- reservations fails), everything in this call — including the
-- order row itself — rolls back automatically. The previous
-- client-side approach could leave an orphaned `orders` row with
-- no line items if a later step failed.
--
-- p_items / p_addons are JSON arrays built client-side, e.g.:
--   p_items:  [{ "product_id": "...", "qty": 2, "unit_price": 5.00 }]
--   p_addons: [{ "addon_id": "...",  "qty": 1, "unit_price": 3.00 }]
-- ============================================================

CREATE OR REPLACE FUNCTION place_order(
    p_customer_name    VARCHAR(150),
    p_customer_phone   VARCHAR(30),
    p_customer_email   VARCHAR(150),
    p_fulfilment_type  VARCHAR(10),
    p_fulfilment_date  DATE,
    p_fulfilment_time  TIME,
    p_delivery_address TEXT,
    p_remarks          TEXT,
    p_total            DECIMAL(12,2),
    p_deposit_required DECIMAL(12,2),
    p_items            JSONB DEFAULT '[]'::jsonb,
    p_addons           JSONB DEFAULT '[]'::jsonb
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
    END LOOP;

    -- 2. Find or create the customer by phone.
    SELECT id INTO v_customer_id
    FROM customers
    WHERE phone = p_customer_phone
    LIMIT 1;

    IF v_customer_id IS NULL THEN
        INSERT INTO customers (name, phone, email, is_guest, created_by)
        VALUES (p_customer_name, p_customer_phone, p_customer_email, true, 'guest')
        RETURNING id INTO v_customer_id;
    END IF;

    -- 3. Create the order.
    INSERT INTO orders (
        customer_id, channel, fulfilment_type, fulfilment_date, fulfilment_time,
        delivery_address, remarks, subtotal, total, deposit_required,
        status, created_by, updated_by
    ) VALUES (
        v_customer_id, 'online', p_fulfilment_type, p_fulfilment_date, p_fulfilment_time,
        p_delivery_address, p_remarks, p_total, p_total, p_deposit_required,
        'awaiting_payment', 'customer', 'customer'
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
    DECIMAL, DECIMAL, JSONB, JSONB
) TO anon, authenticated;
