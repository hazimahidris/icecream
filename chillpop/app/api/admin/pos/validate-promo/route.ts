import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const subtotal = Number(body?.subtotal ?? 0);
  const cartQty = Number(body?.cartQty ?? 0);

  if (!code) {
    return NextResponse.json({ error: "Enter a promo code." }, { status: 400 });
  }

  const { data: discount, error } = await supabaseAdmin
    .from("discounts")
    .select("id, code, type, value, min_qty, valid_from, valid_to, label")
    .ilike("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !discount) {
    return NextResponse.json({ error: "Invalid promo code." }, { status: 404 });
  }

  const today = todayISO();
  if (discount.valid_from && today < discount.valid_from) {
    return NextResponse.json({ error: "This promo code isn't active yet." }, { status: 400 });
  }
  if (discount.valid_to && today > discount.valid_to) {
    return NextResponse.json({ error: "This promo code has expired." }, { status: 400 });
  }
  if (discount.type === "bulk_qty" && discount.min_qty && cartQty < discount.min_qty) {
    return NextResponse.json(
      { error: `Requires at least ${discount.min_qty} pcs in the cart.` },
      { status: 400 }
    );
  }

  // 'percent' and 'bulk_qty' both apply `value` as a percentage off the
  // subtotal; 'flat' applies `value` as a straight RM amount. The schema
  // doesn't spell out bulk_qty's exact semantics beyond the min_qty gate,
  // so this treats it the same as 'percent' once that threshold is met —
  // adjust here if the intended behaviour is different.
  const discountAmount =
    discount.type === "flat"
      ? Math.min(discount.value, subtotal)
      : Math.min(subtotal * (discount.value / 100), subtotal);

  return NextResponse.json({
    discountId: discount.id,
    discountAmount,
    label: discount.label ?? discount.code,
  });
}
