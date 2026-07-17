import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const addonId = typeof body?.addonId === "string" ? body.addonId : "";

  if (!orderId || !addonId) {
    return NextResponse.json({ error: "Missing order or addon." }, { status: 400 });
  }

  const { data: rentalId, error } = await supabaseAdmin.rpc("hand_out_foam_boxes", {
    p_order_id: orderId,
    p_addon_id: addonId,
    p_created_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: rental, error: rentalError } = await supabaseAdmin
    .from("foam_box_rentals")
    .select("qty, deposit_paid")
    .eq("id", rentalId)
    .single();

  if (rentalError) {
    return NextResponse.json({ error: rentalError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    rentalId,
    qty: rental.qty,
    depositPaid: Number(rental.deposit_paid),
  });
}
