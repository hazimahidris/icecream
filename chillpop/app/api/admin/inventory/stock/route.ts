import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const today = todayISO();

  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, name, max_daily_qty, categories ( name )")
    .eq("is_active", true)
    .order("name");

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  const rows = products ?? [];

  // Separate queries rather than embedding — avoids relying on
  // PostgREST's 1:1 relationship detection for product_stock's
  // UNIQUE FK, same reasoning used throughout this project.
  const { data: stock, error: stockError } = await supabaseAdmin
    .from("product_stock")
    .select("product_id, qty_on_hand");

  if (stockError) {
    return NextResponse.json({ error: stockError.message }, { status: 500 });
  }
  const stockMap = new Map((stock ?? []).map((s) => [s.product_id, s.qty_on_hand]));

  // Reserved qty — uses the same 3-status "confirmed" group
  // (confirmed/in_production/ready) that available_stock() itself
  // treats as reserved, for consistency between the two columns.
  // The spec only said "confirmed reservations" literally.
  const { data: reservations, error: reservationsError } = await supabaseAdmin
    .from("reservations")
    .select("product_id, qty")
    .in("status", ["confirmed", "in_production", "ready"])
    .gte("needed_by", today);

  if (reservationsError) {
    return NextResponse.json({ error: reservationsError.message }, { status: 500 });
  }
  const reservedMap = new Map<string, number>();
  for (const r of reservations ?? []) {
    reservedMap.set(r.product_id, (reservedMap.get(r.product_id) ?? 0) + Number(r.qty));
  }

  // Today's still-outstanding scheduled production, for the
  // "production impact" section.
  const { data: todaySchedules, error: schedulesError } = await supabaseAdmin
    .from("production_schedules")
    .select("product_id, qty_planned")
    .eq("scheduled_date", today)
    .in("status", ["queued", "in_production"]);

  if (schedulesError) {
    return NextResponse.json({ error: schedulesError.message }, { status: 500 });
  }
  const todayScheduledMap = new Map<string, number>();
  for (const s of todaySchedules ?? []) {
    todayScheduledMap.set(
      s.product_id,
      (todayScheduledMap.get(s.product_id) ?? 0) + Number(s.qty_planned)
    );
  }

  const availableEntries = await Promise.all(
    rows.map(async (p) => {
      const { data, error } = await supabaseAdmin.rpc("available_stock", {
        p_product_id: p.id,
        p_date: today,
      });
      return [p.id, error ? null : (data as number)] as const;
    })
  );
  const availableMap = new Map(availableEntries);

  const result = rows.map((p) => {
    const category = Array.isArray(p.categories) ? p.categories[0] : p.categories;
    return {
      id: p.id,
      name: p.name,
      category: category?.name ?? null,
      qtyOnHand: stockMap.get(p.id) ?? 0,
      reservedQty: reservedMap.get(p.id) ?? 0,
      availableQty: availableMap.get(p.id) ?? null,
      maxDailyQty: p.max_daily_qty,
      todayScheduledQty: todayScheduledMap.get(p.id) ?? 0,
    };
  });

  return NextResponse.json({ products: result });
}
