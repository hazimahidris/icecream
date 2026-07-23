import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Same "verified and confirmed" order set used by the sales report, for
// consistency across every report page in this admin section.
const INCLUDED_ORDER_STATUSES = ["booking_confirmed", "preparing", "ready", "delivered", "completed"];
const PIPELINE_STATUSES = ["booking_confirmed", "preparing"];

function isValidDateISO(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOfWeekISO(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
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

  const { data: allProducts, error: allProductsError } = await supabaseAdmin
    .from("products")
    .select("id, name");
  if (allProductsError) return NextResponse.json({ error: allProductsError.message }, { status: 500 });
  const productNameMap = new Map((allProducts ?? []).map((p) => [p.id, p.name]));

  // ---------- Section 1: upcoming bookings pipeline (current, not period-scoped) ----------
  const { data: pipelineOrders, error: pipelineError } = await supabaseAdmin
    .from("orders")
    .select("id, fulfilment_date, balance_due, order_items ( product_id, qty )")
    .in("status", PIPELINE_STATUSES);
  if (pipelineError) return NextResponse.json({ error: pipelineError.message }, { status: 500 });

  const pipelineByDate = new Map<
    string,
    { totalOrders: number; totalValueOutstanding: number; flavours: Map<string, number> }
  >();
  for (const o of pipelineOrders ?? []) {
    const date = o.fulfilment_date;
    const entry =
      pipelineByDate.get(date) ??
      { totalOrders: 0, totalValueOutstanding: 0, flavours: new Map<string, number>() };
    entry.totalOrders += 1;
    entry.totalValueOutstanding += Number(o.balance_due);

    const items = Array.isArray(o.order_items) ? o.order_items : [];
    for (const item of items) {
      if (!item.product_id) continue;
      entry.flavours.set(item.product_id, (entry.flavours.get(item.product_id) ?? 0) + Number(item.qty));
    }
    pipelineByDate.set(date, entry);
  }

  const upcomingPipeline = Array.from(pipelineByDate.entries())
    .map(([date, entry]) => ({
      date,
      totalOrders: entry.totalOrders,
      totalValueOutstanding: entry.totalValueOutstanding,
      flavours: Array.from(entry.flavours.entries())
        .map(([productId, qty]) => ({ name: productNameMap.get(productId) ?? "Unknown", qty }))
        .sort((a, b) => b.qty - a.qty),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ---------- Section 2: fulfilment rate (scoped by fulfilment_date) ----------
  const { data: fulfilmentOrders, error: fulfilmentError } = await supabaseAdmin
    .from("orders")
    .select(
      `id, order_number, fulfilment_date, delivered_at, status, customers ( name, phone )`
    )
    .gte("fulfilment_date", start)
    .lte("fulfilment_date", end)
    .in("status", ["delivered", "completed", "cancelled"]);
  if (fulfilmentError) return NextResponse.json({ error: fulfilmentError.message }, { status: 500 });

  let onTimeCount = 0;
  let lateCount = 0;
  let earlyCount = 0;
  let excludedNoTimestamp = 0;
  let cancelledCount = 0;
  const lateOrCancelledList: {
    orderId: string;
    orderNumber: number | null;
    customerName: string | null;
    fulfilmentDate: string;
    reason: string;
  }[] = [];

  for (const o of fulfilmentOrders ?? []) {
    const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;

    if (o.status === "cancelled") {
      cancelledCount += 1;
      lateOrCancelledList.push({
        orderId: o.id,
        orderNumber: o.order_number,
        customerName: customer?.name ?? null,
        fulfilmentDate: o.fulfilment_date,
        reason: "Cancelled",
      });
      continue;
    }

    if (!o.delivered_at) {
      excludedNoTimestamp += 1;
      continue;
    }

    const deliveredDate = o.delivered_at.slice(0, 10);
    if (deliveredDate === o.fulfilment_date) {
      onTimeCount += 1;
    } else if (deliveredDate > o.fulfilment_date) {
      lateCount += 1;
      const days = Math.round(
        (new Date(`${deliveredDate}T00:00:00Z`).getTime() -
          new Date(`${o.fulfilment_date}T00:00:00Z`).getTime()) /
          (24 * 60 * 60 * 1000)
      );
      lateOrCancelledList.push({
        orderId: o.id,
        orderNumber: o.order_number,
        customerName: customer?.name ?? null,
        fulfilmentDate: o.fulfilment_date,
        reason: `Late by ${days} day${days === 1 ? "" : "s"}`,
      });
    } else {
      earlyCount += 1;
    }
  }

  const deliveredWithTimestamp = onTimeCount + lateCount + earlyCount;
  const onTimeRatePct = deliveredWithTimestamp > 0 ? (onTimeCount / deliveredWithTimestamp) * 100 : null;

  // ---------- Section 3: customer purchase history ----------
  const { data: periodOrders, error: periodOrdersError } = await supabaseAdmin
    .from("orders")
    .select("customer_id, total, customers ( name, phone )")
    .in("status", INCLUDED_ORDER_STATUSES)
    .gte("created_at", startTs)
    .lt("created_at", endExclusiveTs);
  if (periodOrdersError) {
    return NextResponse.json({ error: periodOrdersError.message }, { status: 500 });
  }

  const byCustomer = new Map<
    string,
    { name: string | null; phone: string | null; orderCount: number; totalValue: number }
  >();
  for (const o of periodOrders ?? []) {
    if (!o.customer_id) continue;
    const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
    const entry = byCustomer.get(o.customer_id) ?? {
      name: customer?.name ?? null,
      phone: customer?.phone ?? null,
      orderCount: 0,
      totalValue: 0,
    };
    entry.orderCount += 1;
    entry.totalValue += Number(o.total);
    byCustomer.set(o.customer_id, entry);
  }

  const allCustomers = Array.from(byCustomer.entries());
  const topCustomers = allCustomers
    .map(([customerId, v]) => ({ customerId, ...v }))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 10);

  const repeatCustomers = allCustomers.filter(([, v]) => v.orderCount > 1).length;
  const repeatCustomerRatePct =
    allCustomers.length > 0 ? (repeatCustomers / allCustomers.length) * 100 : 0;

  // ---------- Section 4: production efficiency (planned vs actual per flavour per week) ----------
  const { data: scheduleRows, error: scheduleError } = await supabaseAdmin
    .from("production_schedules")
    .select("product_id, scheduled_date, qty_planned")
    .gte("scheduled_date", start)
    .lte("scheduled_date", end)
    .neq("status", "cancelled");
  if (scheduleError) return NextResponse.json({ error: scheduleError.message }, { status: 500 });

  const { data: actualRows, error: actualError } = await supabaseAdmin
    .from("production_log")
    .select("product_id, qty_produced, produced_at")
    .gte("produced_at", startTs)
    .lt("produced_at", endExclusiveTs);
  if (actualError) return NextResponse.json({ error: actualError.message }, { status: 500 });

  const plannedMap = new Map<string, number>();
  for (const r of scheduleRows ?? []) {
    const key = `${r.product_id}|${mondayOfWeekISO(r.scheduled_date)}`;
    plannedMap.set(key, (plannedMap.get(key) ?? 0) + Number(r.qty_planned));
  }
  const actualMap = new Map<string, number>();
  for (const r of actualRows ?? []) {
    const key = `${r.product_id}|${mondayOfWeekISO(r.produced_at.slice(0, 10))}`;
    actualMap.set(key, (actualMap.get(key) ?? 0) + Number(r.qty_produced));
  }

  const allKeys = new Set([...plannedMap.keys(), ...actualMap.keys()]);
  const productionEfficiency = Array.from(allKeys)
    .map((key) => {
      const [productId, weekStart] = key.split("|");
      const planned = plannedMap.get(key) ?? 0;
      const actual = actualMap.get(key) ?? 0;
      return {
        productId,
        name: productNameMap.get(productId) ?? "Unknown",
        weekStart,
        planned,
        actual,
        variance: actual - planned,
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.name.localeCompare(b.name));

  return NextResponse.json({
    range: { start, end },
    upcomingPipeline,
    fulfilmentRate: {
      onTimeCount,
      lateCount,
      earlyCount,
      cancelledCount,
      excludedNoTimestamp,
      onTimeRatePct,
      lateOrCancelledList,
    },
    customerHistory: {
      topCustomers,
      repeatCustomerRatePct,
      totalDistinctCustomers: allCustomers.length,
    },
    productionEfficiency,
  });
}
