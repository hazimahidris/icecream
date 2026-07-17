import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Statuses that still tie up a physical box and an unrefunded deposit.
const ACTIVE_STATUSES = ["rented", "overdue", "partial_return"];
const HANDOUT_ELIGIBLE_ORDER_STATUSES = ["booking_confirmed", "preparing", "ready"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const today = todayISO();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: inventoryRows, error: inventoryError } = await supabaseAdmin
    .from("foam_box_inventory")
    .select("addon_id, total_units, available, rented, lost, deposit_outstanding");

  if (inventoryError) {
    return NextResponse.json({ error: inventoryError.message }, { status: 500 });
  }

  const totals = (inventoryRows ?? []).reduce(
    (acc, row) => ({
      totalUnits: acc.totalUnits + row.total_units,
      available: acc.available + row.available,
      rented: acc.rented + row.rented,
      lost: acc.lost + row.lost,
      depositOutstanding: acc.depositOutstanding + Number(row.deposit_outstanding),
    }),
    { totalUnits: 0, available: 0, rented: 0, lost: 0, depositOutstanding: 0 }
  );

  const rentalAddonIds = (inventoryRows ?? []).map((r) => r.addon_id);

  const { count: overdueCount, error: overdueError } = await supabaseAdmin
    .from("foam_box_rentals")
    .select("id", { count: "exact", head: true })
    .lt("due_date", today)
    .eq("status", "rented");

  if (overdueError) {
    return NextResponse.json({ error: overdueError.message }, { status: 500 });
  }

  const selectColumns = `
    id, order_id, qty, rented_at, due_date, returned_at, return_qty,
    deposit_paid, deposit_refunded, status,
    orders ( order_number, customers ( name, phone ) )
  `;

  const { data: activeRentals, error: activeError } = await supabaseAdmin
    .from("foam_box_rentals")
    .select(selectColumns)
    .in("status", ACTIVE_STATUSES)
    .order("due_date", { ascending: true });

  if (activeError) {
    return NextResponse.json({ error: activeError.message }, { status: 500 });
  }

  const { data: returnedRentals, error: returnedError } = await supabaseAdmin
    .from("foam_box_rentals")
    .select(selectColumns)
    .eq("status", "returned")
    .gte("returned_at", thirtyDaysAgo)
    .order("returned_at", { ascending: false });

  if (returnedError) {
    return NextResponse.json({ error: returnedError.message }, { status: 500 });
  }

  function mapRental(r: NonNullable<typeof activeRentals>[number]) {
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
      customerPhone: customer?.phone ?? null,
      qty: r.qty,
      returnQty: r.return_qty ?? 0,
      handedOutAt: r.rented_at,
      dueDate: r.due_date,
      returnedAt: r.returned_at,
      depositPaid: Number(r.deposit_paid),
      depositRefunded: Number(r.deposit_refunded ?? 0),
      status: r.status,
      // Matches the same rule used for the "Overdue" summary card.
      isOverdue: r.due_date < today && r.status === "rented",
    };
  }

  // Upcoming handouts — orders whose fulfilment is imminent, that
  // ordered a tracked rental addon, and haven't had boxes handed out
  // yet (no foam_box_rentals row for the order).
  let upcomingHandouts: {
    orderId: string;
    orderNumber: number | null;
    orderStatus: string;
    customerName: string | null;
    customerPhone: string | null;
    fulfilmentDate: string;
    qtyOrdered: number;
    depositToCollect: number;
    addonId: string;
    canHandOut: boolean;
  }[] = [];

  if (rentalAddonIds.length > 0) {
    const { data: addonRows, error: addonError } = await supabaseAdmin
      .from("addons")
      .select("id, deposit_amount")
      .in("id", rentalAddonIds);

    if (addonError) {
      return NextResponse.json({ error: addonError.message }, { status: 500 });
    }
    const depositByAddon = new Map(
      (addonRows ?? []).map((a) => [a.id, Number(a.deposit_amount)])
    );

    const { data: handedOutOrderRows, error: handedOutError } = await supabaseAdmin
      .from("foam_box_rentals")
      .select("order_id")
      .not("order_id", "is", null);

    if (handedOutError) {
      return NextResponse.json({ error: handedOutError.message }, { status: 500 });
    }
    const handedOutOrderIds = new Set((handedOutOrderRows ?? []).map((r) => r.order_id));

    const { data: candidateOrders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select(
        `id, order_number, fulfilment_date, status,
         customers ( name, phone ),
         order_items ( addon_id, qty )`
      )
      .gte("fulfilment_date", today)
      .in("status", HANDOUT_ELIGIBLE_ORDER_STATUSES);

    if (ordersError) {
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    upcomingHandouts = (candidateOrders ?? [])
      .filter((o) => !handedOutOrderIds.has(o.id))
      .flatMap((o) => {
        const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
        const items = Array.isArray(o.order_items) ? o.order_items : [];

        // Group by addon in case an order somehow rents more than one
        // tracked addon (e.g. different box sizes in future).
        const qtyByAddon = new Map<string, number>();
        for (const item of items) {
          if (!item.addon_id || !depositByAddon.has(item.addon_id)) continue;
          qtyByAddon.set(item.addon_id, (qtyByAddon.get(item.addon_id) ?? 0) + Number(item.qty));
        }

        return Array.from(qtyByAddon.entries())
          .filter(([, qty]) => qty > 0)
          .map(([addonId, qty]) => ({
            orderId: o.id,
            orderNumber: o.order_number,
            orderStatus: o.status,
            customerName: customer?.name ?? null,
            customerPhone: customer?.phone ?? null,
            fulfilmentDate: o.fulfilment_date,
            qtyOrdered: qty,
            depositToCollect: qty * (depositByAddon.get(addonId) ?? 0),
            addonId,
            canHandOut: o.status === "ready",
          }));
      });
  }

  return NextResponse.json({
    summary: {
      totalUnits: totals.totalUnits,
      available: totals.available,
      rented: totals.rented,
      overdue: overdueCount ?? 0,
      lost: totals.lost,
      depositOutstanding: totals.depositOutstanding,
    },
    upcomingHandouts,
    activeRentals: (activeRentals ?? []).map(mapRental),
    returnedRentals: (returnedRentals ?? []).map(mapRental),
  });
}
