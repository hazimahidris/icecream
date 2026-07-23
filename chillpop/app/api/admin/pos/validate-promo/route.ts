import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DiscountResult = {
  discount_id: string | null;
  discount_code: string | null;
  discount_type: string | null;
  discount_value: number | null;
  discount_min_qty: number | null;
  discount_amount: number;
  source: "promo" | "bulk" | null;
  code_error: string | null;
};

// Called both with a code (the "Apply" button) and without one (a
// background check for an automatic bulk discount as the cart
// changes) — find_applicable_discount() handles both in one place,
// same as the customer site.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const subtotal = Number(body?.subtotal ?? 0);
  const cartQty = Number(body?.cartQty ?? 0);

  const { data, error } = await supabaseAdmin.rpc("find_applicable_discount", {
    p_code: code || null,
    p_cart_qty: cartQty,
    p_subtotal: subtotal,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = (Array.isArray(data) ? data[0] : data) as DiscountResult | undefined;

  if (code && (!result || result.source !== "promo")) {
    return NextResponse.json(
      { error: result?.code_error ?? "Invalid promo code." },
      { status: 404 }
    );
  }

  if (!result || !result.discount_id) {
    return NextResponse.json({ discountId: null, discountAmount: 0, label: null, source: null });
  }

  const label =
    result.source === "bulk"
      ? `Bulk order discount applied: ${result.discount_value}% off for orders of ${result.discount_min_qty}+ pcs`
      : result.discount_code ?? "Promo applied";

  return NextResponse.json({
    discountId: result.discount_id,
    discountAmount: result.discount_amount,
    label,
    source: result.source,
  });
}
