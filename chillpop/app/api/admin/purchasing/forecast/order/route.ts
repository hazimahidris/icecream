import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VALID_HORIZONS = [7, 14];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const ingredientId = typeof body?.ingredientId === "string" ? body.ingredientId : "";
  const horizonDays = Number(body?.horizonDays ?? NaN);
  const qtyOnHand = Number(body?.qtyOnHand ?? NaN);
  const qtyRequired = Number(body?.qtyRequired ?? NaN);
  const qtyToPurchase = Number(body?.qtyToPurchase ?? NaN);

  if (!ingredientId) {
    return NextResponse.json({ error: "Missing ingredient." }, { status: 400 });
  }
  if (!VALID_HORIZONS.includes(horizonDays)) {
    return NextResponse.json({ error: "Invalid horizon." }, { status: 400 });
  }
  if ([qtyOnHand, qtyRequired, qtyToPurchase].some((n) => Number.isNaN(n) || n < 0)) {
    return NextResponse.json({ error: "Invalid forecast quantities." }, { status: 400 });
  }

  const today = todayISO();

  const { data, error } = await supabaseAdmin
    .from("purchase_forecasts")
    .insert({
      ingredient_id: ingredientId,
      forecast_date: today,
      forecast_horizon: addDaysISO(today, horizonDays),
      qty_required: qtyRequired,
      qty_on_hand: qtyOnHand,
      qty_to_purchase: qtyToPurchase,
      status: "ordered",
      created_by: "admin",
      updated_by: "admin",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
