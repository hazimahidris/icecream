import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const qtyReceived = Number(body?.qtyReceived ?? NaN);
  if (Number.isNaN(qtyReceived) || qtyReceived <= 0) {
    return NextResponse.json({ error: "Enter a valid quantity received." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("mark_purchase_received", {
    p_forecast_id: id,
    p_qty_received: qtyReceived,
    p_created_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data });
}
