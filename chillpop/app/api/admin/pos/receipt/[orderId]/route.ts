import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  // Scoped to channel = 'pos' — this receipt format (cashier line,
  // thermal-printer layout) is specific to POS sales, not the
  // customer-site order flow.
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      `order_number, created_at, subtotal, discount_amount, total,
       payment_method, discounts ( code )`
    )
    .eq("id", orderId)
    .eq("channel", "pos")
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  }

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("qty, unit_price, products ( name ), addons ( name )")
    .eq("order_id", orderId);

  const flavours = (items ?? [])
    .filter((item) => item.products)
    .map((item) => {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      return { name: product?.name ?? "Item", qty: item.qty, unitPrice: item.unit_price };
    });

  const addons = (items ?? [])
    .filter((item) => item.addons)
    .map((item) => {
      const addon = Array.isArray(item.addons) ? item.addons[0] : item.addons;
      return { name: addon?.name ?? "Add-on", qty: item.qty, unitPrice: item.unit_price };
    });

  const discount = Array.isArray(order.discounts) ? order.discounts[0] : order.discounts;

  return NextResponse.json({
    orderNumber: order.order_number,
    createdAt: order.created_at,
    subtotal: order.subtotal,
    discountAmount: order.discount_amount,
    discountCode: discount?.code ?? null,
    total: order.total,
    paymentMethod: order.payment_method,
    flavours,
    addons,
  });
}
