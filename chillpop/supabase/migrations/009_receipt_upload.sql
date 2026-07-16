-- ============================================================
-- Receipt upload support for /order/[orderId]/payment.
--
-- Storage: 'receipts' bucket, public read disabled (per spec).
-- Anon gets INSERT (upload) only — no SELECT/UPDATE/DELETE policy
-- is granted, so uploaded files can't be listed, downloaded, or
-- overwritten via the anon key. Viewing a receipt later requires a
-- signed URL generated with elevated privileges (e.g. from a
-- future admin panel using the service_role key) — not built here.
--
-- file_size_limit / allowed_mime_types enforce the 5MB / JPG-PNG-PDF
-- rule server-side, since client-side validation alone can be
-- bypassed by calling the Storage API directly.
--
-- submit_payment_receipt() is SECURITY DEFINER, same reasoning as
-- place_order(): this only ever inserts one payment_receipts row
-- and sets status = 'payment_submitted' for the exact order_id
-- passed in — it computes is_deposit from the order's own stored
-- total rather than trusting a client-supplied value, and can't be
-- abused to modify unrelated order fields the way a blanket UPDATE
-- policy on `orders` could be.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'receipts',
    'receipts',
    false,
    5242880, -- 5MB
    ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "anon can upload receipts"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'receipts');

CREATE OR REPLACE FUNCTION submit_payment_receipt(
    p_order_id           UUID,
    p_amount_claimed     DECIMAL(12,2),
    p_bank_name          VARCHAR(100),
    p_transfer_reference VARCHAR(200),
    p_transfer_datetime  TIMESTAMPTZ,
    p_receipt_url        VARCHAR(500),
    p_file_type          VARCHAR(10)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total      DECIMAL(12,2);
    v_receipt_id UUID;
BEGIN
    SELECT total INTO v_total FROM orders WHERE id = p_order_id;

    IF v_total IS NULL THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;

    INSERT INTO payment_receipts (
        order_id, is_deposit, amount_claimed, bank_name,
        transfer_reference, transfer_datetime, receipt_url, file_type,
        verification_status, created_by
    ) VALUES (
        p_order_id, p_amount_claimed < v_total, p_amount_claimed, p_bank_name,
        p_transfer_reference, p_transfer_datetime, p_receipt_url, p_file_type,
        'pending', 'customer'
    ) RETURNING id INTO v_receipt_id;

    UPDATE orders
    SET status = 'payment_submitted', updated_by = 'customer'
    WHERE id = p_order_id;

    RETURN v_receipt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_payment_receipt(
    UUID, DECIMAL, VARCHAR, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR
) TO anon, authenticated;
