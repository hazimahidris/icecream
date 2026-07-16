-- ============================================================
-- Order tracking for /order/track.
--
-- Same SECURITY DEFINER pattern as the other order-lookup
-- functions: no direct SELECT policy on customers/orders is
-- opened up. track_order() only returns a row when BOTH the order
-- number AND the customer's phone match — if either is wrong, it
-- returns zero rows, identical to "order doesn't exist" from the
-- caller's perspective. That's deliberate: it avoids leaking
-- "order exists but wrong phone" vs "no such order" as distinct
-- signals, which would let someone enumerate valid order numbers.
--
-- Phone comparison strips non-digit characters from both sides
-- (regexp_replace) so "012-3456789" and "0123456789" match — the
-- customer isn't required to reproduce exact formatting.
--
-- rejection_reason and items are fetched via correlated subqueries
-- so the whole thing stays one round trip from the client.
-- ============================================================

CREATE OR REPLACE FUNCTION track_order(p_order_number INT, p_phone VARCHAR)
RETURNS TABLE (
    id               UUID,
    order_number     INT,
    status           VARCHAR,
    fulfilment_date  DATE,
    total            DECIMAL,
    rejection_reason TEXT,
    items            JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        o.order_number,
        o.status,
        o.fulfilment_date,
        o.total,
        (
            SELECT pr.rejection_reason
            FROM payment_receipts pr
            WHERE pr.order_id = o.id
            ORDER BY pr.submitted_at DESC
            LIMIT 1
        ) AS rejection_reason,
        (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'name', p.name,
                'qty', oi.qty
            )), '[]'::jsonb)
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = o.id AND oi.product_id IS NOT NULL
        ) AS items
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.order_number = p_order_number
      AND regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g');
END;
$$;

GRANT EXECUTE ON FUNCTION track_order(INT, VARCHAR) TO anon, authenticated;
