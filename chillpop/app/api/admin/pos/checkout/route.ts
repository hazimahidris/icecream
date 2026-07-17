import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const items = Array.isArray(body?.items) ? body.items : [];
  const paymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod : "";
  const subtotal = Number(body?.subtotal ?? NaN);
  const discountAmount = Number(body?.discountAmount ?? 0);
  const discountId = typeof body?.discountId === "string" ? body.discountId : null;
  const total = Number(body?.total ?? NaN);

  if (items.length === 0) {
    return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
  }
  if (!["cash", "qr", "online_transfer"].includes(paymentMethod)) {
    return NextResponse.json({ error: "Select a payment method." }, { status: 400 });
  }
  if (Number.isNaN(subtotal) || Number.isNaN(total)) {
    return NextResponse.json({ error: "Invalid order total." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("pos_checkout", {
    p_items: items,
    p_payment_method: paymentMethod,
    p_subtotal: subtotal,
    p_discount_amount: discountAmount,
    p_discount_id: discountId,
    p_total: total,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = data?.[0];
  if (!row) {
    return NextResponse.json({ error: "Checkout did not return an order." }, { status: 500 });
  }

  return NextResponse.json({ id: row.id, order_number: row.order_number });
}
