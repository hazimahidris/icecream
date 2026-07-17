import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// 1=Monday...7=Sunday — matches production_capacity_config's seed data
// convention (see also app/admin/calendar/page.tsx, which duplicates
// this same conversion for its own date-range needs).
function isoDayOfWeek(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export async function GET() {
  const today = todayISO();

  const { data: schedules, error: schedulesError } = await supabaseAdmin
    .from("production_schedules")
    .select(
      "id, qty_planned, start_time, complete_by, packaging_time, status, products ( id, name )"
    )
    .eq("scheduled_date", today)
    .in("status", ["queued", "in_production"])
    .order("start_time");

  if (schedulesError) {
    return NextResponse.json({ error: schedulesError.message }, { status: 500 });
  }

  const { data: ingredientPull, error: pullError } = await supabaseAdmin.rpc(
    "todays_ingredient_pull",
    { p_date: today }
  );

  if (pullError) {
    return NextResponse.json({ error: pullError.message }, { status: 500 });
  }

  const { data: capacityConfig, error: capacityError } = await supabaseAdmin
    .from("production_capacity_config")
    .select("day_of_week, specific_date, max_qty");

  if (capacityError) {
    return NextResponse.json({ error: capacityError.message }, { status: 500 });
  }

  const specific = (capacityConfig ?? []).find((c) => c.specific_date === today);
  const byDow = (capacityConfig ?? []).find(
    (c) => c.day_of_week === isoDayOfWeek(today)
  );
  const maxCapacity = specific?.max_qty ?? byDow?.max_qty ?? null;

  const rows = schedules ?? [];
  const plannedQty = rows.reduce((sum, s) => sum + Number(s.qty_planned), 0);

  return NextResponse.json({
    date: today,
    schedules: rows.map((s) => {
      const product = Array.isArray(s.products) ? s.products[0] : s.products;
      return {
        id: s.id,
        productId: product?.id ?? null,
        productName: product?.name ?? "Item",
        qtyPlanned: s.qty_planned,
        startTime: s.start_time,
        completeBy: s.complete_by,
        packagingTime: s.packaging_time,
        status: s.status,
      };
    }),
    ingredientPull: ingredientPull ?? [],
    plannedQty,
    maxCapacity,
  });
}
