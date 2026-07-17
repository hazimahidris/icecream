import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const qtyWasted = Number(body?.qtyWasted ?? NaN);
  const wastageReason = typeof body?.wastageReason === "string" ? body.wastageReason : "";

  if (!Number.isInteger(qtyWasted) || qtyWasted <= 0) {
    return NextResponse.json({ error: "Enter a valid whole number quantity." }, { status: 400 });
  }
  if (!wastageReason) {
    return NextResponse.json({ error: "Select a reason." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("log_product_wastage", {
    p_product_id: id,
    p_qty_wasted: qtyWasted,
    p_wastage_reason: wastageReason,
    p_created_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, adjustmentId: data });
}
