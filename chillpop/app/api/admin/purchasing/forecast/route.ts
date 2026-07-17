import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VALID_HORIZONS = [7, 14];

type ForecastRpcRow = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  is_approximate: boolean | null;
  qty_on_hand: number;
  qty_required: number;
  qty_to_purchase: number;
  low_stock_threshold: number;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const horizonDays = Number(searchParams.get("horizonDays") ?? 7);

  if (!VALID_HORIZONS.includes(horizonDays)) {
    return NextResponse.json({ error: "Invalid horizon." }, { status: 400 });
  }

  const today = todayISO();
  const horizonDate = addDaysISO(today, horizonDays);

  const { data: forecastRows, error: forecastError } = await supabaseAdmin.rpc(
    "generate_purchase_forecast",
    { p_horizon_date: horizonDate }
  ) as { data: ForecastRpcRow[] | null; error: { message: string } | null };

  if (forecastError) {
    return NextResponse.json({ error: forecastError.message }, { status: 500 });
  }

  const { data: pendingOrders, error: pendingError } = await supabaseAdmin
    .from("purchase_forecasts")
    .select(
      `id, forecast_date, forecast_horizon, qty_required, qty_on_hand, qty_to_purchase,
       created_at, ingredients ( name, unit )`
    )
    .eq("status", "ordered")
    .order("created_at", { ascending: false });

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  return NextResponse.json({
    horizonDays,
    horizonDate,
    forecast: (forecastRows ?? []).map((r) => ({
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      unit: r.unit,
      isApproximate: r.is_approximate,
      qtyOnHand: Number(r.qty_on_hand),
      qtyRequired: Number(r.qty_required),
      qtyToPurchase: Number(r.qty_to_purchase),
    })),
    pendingOrders: (pendingOrders ?? []).map((p) => {
      const ingredient = Array.isArray(p.ingredients) ? p.ingredients[0] : p.ingredients;
      return {
        id: p.id,
        ingredientName: ingredient?.name ?? "-",
        unit: ingredient?.unit ?? "",
        forecastDate: p.forecast_date,
        forecastHorizon: p.forecast_horizon,
        qtyRequired: Number(p.qty_required),
        qtyOnHand: Number(p.qty_on_hand),
        qtyToPurchase: Number(p.qty_to_purchase),
        createdAt: p.created_at,
      };
    }),
  });
}
