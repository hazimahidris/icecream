import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Single status filter shared by every figure on this report — summary
// cards, online/POS split, daily revenue, and the flavour breakdown all
// need to tie out against each other, so they all read from the same
// order set instead of each having their own exclusion list.
const INCLUDED_STATUSES = ["booking_confirmed", "preparing", "ready", "delivered", "completed"];

// Orders still in the payment pipeline — not counted in revenue above,
// but surfaced separately so pipeline volume isn't invisible.
const PENDING_VERIFICATION_STATUSES = ["awaiting_payment", "payment_submitted"];

function isValidDateISO(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";

  if (!isValidDateISO(start) || !isValidDateISO(end) || start > end) {
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  }

  const startTs = `${start}T00:00:00.000Z`;
  const endExclusiveTs = `${addDaysISO(end, 1)}T00:00:00.000Z`;

  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("orders")
    .select("id, channel, total, created_at")
    .in("status", INCLUDED_STATUSES)
    .gte("created_at", startTs)
    .lt("created_at", endExclusiveTs);

  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 500 });
  }

  const includedOrders = orders ?? [];

  const totalRevenue = includedOrders.reduce((sum, o) => sum + Number(o.total), 0);
  const totalOrders = includedOrders.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const online = includedOrders.filter((o) => o.channel === "online");
  const pos = includedOrders.filter((o) => o.channel === "pos");

  // Daily revenue — every day in the range gets an entry, even if 0,
  // so the chart doesn't skip gaps.
  const dailyMap = new Map<string, number>();
  for (let d = start; d <= end; d = addDaysISO(d, 1)) {
    dailyMap.set(d, 0);
  }
  for (const o of includedOrders) {
    const day = o.created_at.slice(0, 10);
    if (dailyMap.has(day)) {
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + Number(o.total));
    }
  }
  const dailyRevenue = Array.from(dailyMap.entries()).map(([date, revenue]) => ({
    date,
    revenue,
  }));

  // Revenue by flavour — same order set as everything else above, so
  // this table's total always ties out with the Total Revenue card.
  const includedOrderIds = includedOrders.map((o) => o.id);

  let flavourBreakdown: { productId: string; name: string; totalPcs: number; revenue: number }[] = [];

  if (includedOrderIds.length > 0) {
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("order_items")
      .select("order_id, product_id, qty, unit_price")
      .in("order_id", includedOrderIds)
      .not("product_id", "is", null);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    const { data: products, error: productsError } = await supabaseAdmin
      .from("products")
      .select("id, name");

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 });
    }
    const productNameMap = new Map((products ?? []).map((p) => [p.id, p.name]));

    const byProduct = new Map<string, { totalPcs: number; revenue: number }>();
    for (const item of items ?? []) {
      if (!item.product_id) continue;
      const entry = byProduct.get(item.product_id) ?? { totalPcs: 0, revenue: 0 };
      entry.totalPcs += Number(item.qty);
      entry.revenue += Number(item.qty) * Number(item.unit_price);
      byProduct.set(item.product_id, entry);
    }

    flavourBreakdown = Array.from(byProduct.entries())
      .map(([productId, v]) => ({
        productId,
        name: productNameMap.get(productId) ?? "Unknown",
        totalPcs: v.totalPcs,
        revenue: v.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  const bestSeller = flavourBreakdown[0] ?? null;

  // Pipeline visibility — orders awaiting payment verification in the
  // same period, deliberately excluded from the revenue figures above.
  const { data: pendingOrders, error: pendingError } = await supabaseAdmin
    .from("orders")
    .select("total")
    .in("status", PENDING_VERIFICATION_STATUSES)
    .gte("created_at", startTs)
    .lt("created_at", endExclusiveTs);

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  const pendingVerification = {
    count: (pendingOrders ?? []).length,
    total: (pendingOrders ?? []).reduce((sum, o) => sum + Number(o.total), 0),
  };

  return NextResponse.json({
    range: { start, end },
    summary: {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      online: { count: online.length, revenue: online.reduce((s, o) => s + Number(o.total), 0) },
      pos: { count: pos.length, revenue: pos.reduce((s, o) => s + Number(o.total), 0) },
    },
    flavourBreakdown,
    dailyRevenue,
    bestSeller,
    pendingVerification,
  });
}
