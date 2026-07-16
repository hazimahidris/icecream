-- ============================================================
-- Admin payment review actions for /admin/payments.
--
-- These are called exclusively from Next.js Route Handlers using the
-- Supabase service_role key (see lib/supabaseAdmin.ts), never from
-- the browser. service_role already bypasses RLS, so SECURITY
-- DEFINER isn't needed here — but Postgres grants EXECUTE on new
-- functions to PUBLIC by default, and PUBLIC includes anon and
-- authenticated. Without an explicit REVOKE, these would be directly
-- callable by anyone with the public anon key, completely bypassing
-- the admin login page. The REVOKE below closes that.
--
-- Each function does its multi-table update in one call — one
-- Postgres transaction — so a partial failure (e.g. reservations
-- update fails after orders already changed) can't happen.
-- ============================================================

CREATE OR REPLACE FUNCTION approve_payment_receipt(
    p_receipt_id UUID,
    p_admin_name VARCHAR(150)
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_amount   DECIMAL(12,2);
BEGIN
    SELECT order_id, amount_claimed INTO v_order_id, v_amount
    FROM payment_receipts
    WHERE id = p_receipt_id;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'Receipt not found.';
    END IF;

    UPDATE payment_receipts
    SET verification_status = 'approved',
        verified_by = p_admin_name,
        verified_at = now()
    WHERE id = p_receipt_id;

    UPDATE orders
    SET status = 'booking_confirmed',
        deposit_paid = v_amount,
        updated_by = p_admin_name
    WHERE id = v_order_id;

    -- This is the moment stock becomes reserved — not before.
    UPDATE reservations
    SET status = 'confirmed',
        updated_by = p_admin_name
    WHERE order_id = v_order_id AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION reject_payment_receipt(
    p_receipt_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
BEGIN
    SELECT order_id INTO v_order_id
    FROM payment_receipts
    WHERE id = p_receipt_id;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'Receipt not found.';
    END IF;

    UPDATE payment_receipts
    SET verification_status = 'rejected',
        rejection_reason = p_reason
    WHERE id = p_receipt_id;

    UPDATE orders
    SET status = 'payment_rejected'
    WHERE id = v_order_id;

    -- reservations intentionally untouched — stays 'pending', stock
    -- stays unreserved.
END;
$$;

CREATE OR REPLACE FUNCTION request_new_payment_receipt(p_receipt_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
BEGIN
    SELECT order_id INTO v_order_id
    FROM payment_receipts
    WHERE id = p_receipt_id;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'Receipt not found.';
    END IF;

    UPDATE payment_receipts
    SET verification_status = 'request_new'
    WHERE id = p_receipt_id;

    UPDATE orders
    SET status = 'awaiting_payment'
    WHERE id = v_order_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_payment_receipt(UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reject_payment_receipt(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION request_new_payment_receipt(UUID) FROM PUBLIC;
