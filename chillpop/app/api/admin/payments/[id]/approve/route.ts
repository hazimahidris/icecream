import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendBookingConfirmationEmail } from "@/lib/sendBookingConfirmation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const adminName =
    typeof body?.adminName === "string" ? body.adminName.trim() : "";

  if (!adminName) {
    return NextResponse.json(
      { error: "Admin name is required." },
      { status: 400 }
    );
  }

  const { data: receipt } = await supabaseAdmin
    .from("payment_receipts")
    .select("order_id")
    .eq("id", id)
    .single();

  const { error } = await supabaseAdmin.rpc("approve_payment_receipt", {
    p_receipt_id: id,
    p_admin_name: adminName,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort — sendBookingConfirmationEmail never throws, so a
  // missing/undeliverable email can't turn a successful approval into
  // an error response.
  if (receipt?.order_id) {
    await sendBookingConfirmationEmail(receipt.order_id);
  }

  return NextResponse.json({ ok: true });
}
