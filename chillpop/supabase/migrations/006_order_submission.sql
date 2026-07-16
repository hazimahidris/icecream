-- ============================================================
-- Order submission (Step 6 of /order/[productId]): lets guest
-- customers place an order without any auth in place yet.
--
-- customers is deliberately NOT given a direct SELECT or INSERT
-- policy. Doing so would let anyone holding the anon key (public
-- in the browser bundle) query every customer's name/phone/email,
-- or insert junk rows directly. Instead, find_or_create_customer()
-- is SECURITY DEFINER: it runs with elevated privileges to look up
-- or create exactly one customer by phone number, but the anon
-- role can only reach that narrow behaviour through the function
-- call — it has no ability to browse or write the table directly.
--
-- orders / order_items / reservations get plain INSERT policies.
-- The client generates its own UUIDs before inserting, so it never
-- needs a SELECT policy just to read a row back after writing it.
-- These tables hold order data, not standalone PII, so open INSERT
-- from anon is the expected shape for a no-auth storefront (same
-- reasoning as the public product/category read policies).
-- ============================================================

CREATE POLICY "anon can insert orders" ON orders
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "anon can insert order_items" ON order_items
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "anon can insert reservations" ON reservations
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION find_or_create_customer(
    p_name  VARCHAR(150),
    p_phone VARCHAR(30),
    p_email VARCHAR(150)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_customer_id UUID;
BEGIN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE phone = p_phone
    LIMIT 1;

    IF v_customer_id IS NOT NULL THEN
        RETURN v_customer_id;
    END IF;

    INSERT INTO customers (name, phone, email, is_guest, created_by)
    VALUES (p_name, p_phone, p_email, true, 'guest')
    RETURNING id INTO v_customer_id;

    RETURN v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION find_or_create_customer(VARCHAR, VARCHAR, VARCHAR)
    TO anon, authenticated;
