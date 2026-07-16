import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") === "approved" ? "approved" : "pending";

  const { data, error } = await supabaseAdmin
    .from("payment_receipts")
    .select(
      `id, amount_claimed, bank_name, transfer_reference, transfer_datetime,
       receipt_url, file_type, verification_status, submitted_at,
       verified_by, verified_at, rejection_reason,
       orders (
         id, order_number, total, fulfilment_date,
         customers ( name, phone )
       )`
    )
    .eq("verification_status", status)
    .order(status === "approved" ? "verified_at" : "submitted_at", {
      ascending: false,
    })
    .limit(status === "approved" ? 50 : 200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Storage bucket is private (no public read) — generate a short-lived
  // signed URL per receipt so the admin can view the file.
  const receipts = await Promise.all(
    (data ?? []).map(async (receipt) => {
      const { data: signed } = await supabaseAdmin.storage
        .from("receipts")
        .createSignedUrl(receipt.receipt_url, 3600);

      return { ...receipt, signed_url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ receipts });
}
