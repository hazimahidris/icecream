import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Backs both Month and Week views — both are just "total pcs reserved
// per day within a date range", differing only in range size.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start and end are required." }, { status: 400 });
  }

  const { data: rows, error } = await supabaseAdmin
    .from("reservations")
    .select("needed_by, qty")
    .in("status", ["confirmed", "in_production", "ready"])
    .gte("needed_by", start)
    .lte("needed_by", end);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dailyTotals: Record<string, number> = {};
  for (const row of rows ?? []) {
    dailyTotals[row.needed_by] = (dailyTotals[row.needed_by] ?? 0) + Number(row.qty);
  }

  const { data: capacityConfig, error: capacityError } = await supabaseAdmin
    .from("production_capacity_config")
    .select("day_of_week, specific_date, max_qty");

  if (capacityError) {
    return NextResponse.json({ error: capacityError.message }, { status: 500 });
  }

  return NextResponse.json({ dailyTotals, capacityConfig: capacityConfig ?? [] });
}
