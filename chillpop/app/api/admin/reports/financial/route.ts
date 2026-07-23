import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildProductCostMap, type ProductCost } from "@/lib/productCost";

// "Fulfilled" = actually handed over to the customer.
const FULFILLED_STATUSES = ["delivered", "completed"];
const OUTSTANDING_STATUSES = ["booking_confirmed", "preparing", "ready", "delivered"];
const ACTIVE_RENTAL_STATUSES = ["rented", "overdue", "partial_return"];
const LOW_MARGIN_THRESHOLD = 20;

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

  // ---------- Section 1 + 4: profit by flavour / revenue summary ----------
  const { data: fulfilledOrders, error: ordersError } = await supabaseAdmin
    .from("orders")
    .select("id")
    .in("status", FULFILLED_STATUSES)
    .gte("created_at", startTs)
    .lt("created_at", endExclusiveTs);

  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 500 });
  }
  const fulfilledOrderIds = (fulfilledOrders ?? []).map((o) => o.id);

  let profitByFlavour: {
    productId: string;
    name: string;
    qtySold: number;
    revenue: number;
    cost: number;
    grossProfit: number;
    grossMarginPct: number;
    isLowMargin: boolean;
  }[] = [];

  if (fulfilledOrderIds.length > 0) {
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("order_items")
      .select("product_id, qty, unit_price")
      .in("order_id", fulfilledOrderIds)
      .not("product_id", "is", null);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    let productCostMap: Map<string, ProductCost>;
    try {
      productCostMap = await buildProductCostMap();
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }

    const byProduct = new Map<string, { qty: number; revenue: number }>();
    for (const item of items ?? []) {
      if (!item.product_id) continue;
      const entry = byProduct.get(item.product_id) ?? { qty: 0, revenue: 0 };
      entry.qty += Number(item.qty);
      entry.revenue += Number(item.qty) * Number(item.unit_price);
      byProduct.set(item.product_id, entry);
    }

    profitByFlavour = Array.from(byProduct.entries())
      .map(([productId, { qty, revenue }]) => {
        const productCost = productCostMap.get(productId);
        const cost = qty * (productCost?.costPerUnit ?? 0);
        const grossProfit = revenue - cost;
        const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

        return {
          productId,
          name: productCost?.name ?? "Unknown",
          qtySold: qty,
          revenue,
          cost,
          grossProfit,
          grossMarginPct,
          isLowMargin: grossMarginPct < LOW_MARGIN_THRESHOLD,
        };
      })
      .sort((a, b) => b.grossProfit - a.grossProfit);
  }

  const revenueSummary = profitByFlavour.reduce(
    (acc, row) => ({
      grossRevenue: acc.grossRevenue + row.revenue,
      estimatedCost: acc.estimatedCost + row.cost,
      estimatedGrossProfit: acc.estimatedGrossProfit + row.grossProfit,
    }),
    { grossRevenue: 0, estimatedCost: 0, estimatedGrossProfit: 0 }
  );

  // ---------- Section 2: outstanding payments (current snapshot, not period-scoped) ----------
  const { data: outstandingOrders, error: outstandingError } = await supabaseAdmin
    .from("orders")
    .select(
      `id, order_number, fulfilment_date, total, deposit_paid, balance_due,
       customers ( name, phone )`
    )
    .in("status", OUTSTANDING_STATUSES)
    .gt("balance_due", 0)
    .order("fulfilment_date", { ascending: true });

  if (outstandingError) {
    return NextResponse.json({ error: outstandingError.message }, { status: 500 });
  }

  const outstandingPayments = (outstandingOrders ?? []).map((o) => {
    const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
    return {
      orderId: o.id,
      orderNumber: o.order_number,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      fulfilmentDate: o.fulfilment_date,
      total: Number(o.total),
      depositPaid: Number(o.deposit_paid),
      balanceDue: Number(o.balance_due),
    };
  });

  // ---------- Section 3: foam box deposit ledger (all-time + current active) ----------
  const { data: allRentals, error: rentalsError } = await supabaseAdmin
    .from("foam_box_rentals")
    .select("id, order_id, qty, deposit_paid, deposit_refunded, status, orders ( order_number, customers ( name, phone ) )");

  if (rentalsError) {
    return NextResponse.json({ error: rentalsError.message }, { status: 500 });
  }

  const totalDeposits = (allRentals ?? []).reduce((s, r) => s + Number(r.deposit_paid), 0);
  const totalRefunded = (allRentals ?? []).reduce(
    (s, r) => s + Number(r.deposit_refunded ?? 0),
    0
  );

  const activeRentals = (allRentals ?? [])
    .filter((r) => ACTIVE_RENTAL_STATUSES.includes(r.status))
    .map((r) => {
      const order = Array.isArray(r.orders) ? r.orders[0] : r.orders;
      const customer = order
        ? Array.isArray(order.customers)
          ? order.customers[0]
          : order.customers
        : null;
      return {
        id: r.id,
        orderNumber: order?.order_number ?? null,
        customerName: customer?.name ?? null,
        qty: r.qty,
        depositPaid: Number(r.deposit_paid),
        depositRefunded: Number(r.deposit_refunded ?? 0),
        status: r.status,
      };
    });

  return NextResponse.json({
    range: { start, end },
    profitByFlavour,
    lowMarginThreshold: LOW_MARGIN_THRESHOLD,
    revenueSummary,
    outstandingPayments,
    foamBoxLedger: {
      totalDeposits,
      totalRefunded,
      netHeld: totalDeposits - totalRefunded,
      activeRentals,
    },
  });
}
