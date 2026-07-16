-- ============================================================
-- Support for /order/[orderId]/payment.
--
-- 1. order_number: a customer-friendly sequential code (ORD-0001)
--    instead of exposing the raw UUID.
--
-- 2. get_order_for_payment(): customers still has no direct SELECT
--    policy (PII lockdown from migration 006). This SECURITY
--    DEFINER function returns only the specific fields the payment
--    page needs, for exactly one order id — not general table
--    access. Anyone who has the order's UUID (a 128-bit value,
--    effectively a payment-link token) can view that one order's
--    payment info, same pattern as most guest-checkout confirmation
--    pages that don't require login.
-- ============================================================

ALTER TABLE orders ADD COLUMN order_number SERIAL UNIQUE;

CREATE OR REPLACE FUNCTION get_order_for_payment(p_order_id UUID)
RETURNS TABLE (
    id                UUID,
    order_number      INT,
    customer_name     VARCHAR,
    status            VARCHAR,
    fulfilment_type   VARCHAR,
    fulfilment_date   DATE,
    fulfilment_time   TIME,
    total             DECIMAL,
    deposit_required  DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id, o.order_number, c.name, o.status, o.fulfilment_type,
        o.fulfilment_date, o.fulfilment_time, o.total, o.deposit_required
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_order_for_payment(UUID) TO anon, authenticated;
