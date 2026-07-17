import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type JoinedReservation = {
  order_id: string;
  qty: number;
  products: { name: string } | { name: string }[] | null;
  orders:
    | {
        order_number: number;
        fulfilment_type: string;
        fulfilment_time: string | null;
        customers: { name: string } | { name: string }[] | null;
      }
    | {
        order_number: number;
        fulfilment_type: string;
        fulfilment_time: string | null;
        customers: { name: string } | { name: string }[] | null;
      }[]
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "date is required." }, { status: 400 });
  }

  // "fulfilment_date" in the spec maps to reservations.needed_by — the
  // actual fulfilment_date column lives on orders, not reservations.
  const { data: rows, error } = await supabaseAdmin
    .from("reservations")
    .select(
      `order_id, qty,
       products ( name ),
       orders ( order_number, fulfilment_type, fulfilment_time, customers ( name ) )`
    )
    .eq("needed_by", date)
    .in("status", ["confirmed", "in_production", "ready"])
    .returns<JoinedReservation[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ordersMap = new Map<
    string,
    {
      orderId: string;
      orderNumber: number | null;
      customerName: string | null;
      fulfilmentType: string | null;
      fulfilmentTime: string | null;
      flavours: { name: string; qty: number }[];
    }
  >();
  const flavourTotalsMap = new Map<string, number>();

  for (const row of rows ?? []) {
    const order = one(row.orders);
    const customer = order ? one(order.customers) : null;
    const product = one(row.products);
    const flavourName = product?.name ?? "Item";

    if (!ordersMap.has(row.order_id)) {
      ordersMap.set(row.order_id, {
        orderId: row.order_id,
        orderNumber: order?.order_number ?? null,
        customerName: customer?.name ?? null,
        fulfilmentType: order?.fulfilment_type ?? null,
        fulfilmentTime: order?.fulfilment_time ?? null,
        flavours: [],
      });
    }
    ordersMap.get(row.order_id)!.flavours.push({ name: flavourName, qty: Number(row.qty) });

    flavourTotalsMap.set(flavourName, (flavourTotalsMap.get(flavourName) ?? 0) + Number(row.qty));
  }

  const orders = Array.from(ordersMap.values());
  const flavourTotals = Array.from(flavourTotalsMap.entries()).map(([name, qty]) => ({
    name,
    qty,
  }));

  // Remaining available stock per flavour for this date — every active
  // product, not just ones with reservations, so staff see the full picture.
  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  const stockByFlavour = await Promise.all(
    (products ?? []).map(async (product) => {
      const { data: available, error: stockError } = await supabaseAdmin.rpc(
        "available_stock",
        { p_product_id: product.id, p_date: date }
      );
      return {
        productId: product.id,
        name: product.name,
        available: stockError ? null : (available as number),
      };
    })
  );

  return NextResponse.json({ orders, flavourTotals, stockByFlavour });
}
