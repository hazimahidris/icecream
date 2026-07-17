import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const refundAmount = Number(body?.refundAmount ?? NaN);
  if (Number.isNaN(refundAmount) || refundAmount <= 0) {
    return NextResponse.json({ error: "Enter a valid refund amount." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("refund_foam_box_deposit", {
    p_rental_id: id,
    p_refund_amount: refundAmount,
    p_created_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rentalId: data });
}
