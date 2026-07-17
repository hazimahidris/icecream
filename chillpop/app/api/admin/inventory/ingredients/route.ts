import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data: ingredients, error: ingredientsError } = await supabaseAdmin
    .from("ingredients")
    .select("id, name, category, unit, low_stock_threshold, is_sundry")
    .order("name");

  if (ingredientsError) {
    return NextResponse.json({ error: ingredientsError.message }, { status: 500 });
  }

  // Fetched separately from ingredients rather than embedded — avoids
  // relying on PostgREST's 1:1 relationship detection for the
  // ingredient_stock.ingredient_id UNIQUE FK, same reasoning as the
  // product/product_stock split used elsewhere in this project.
  const { data: stock, error: stockError } = await supabaseAdmin
    .from("ingredient_stock")
    .select("ingredient_id, qty_on_hand, last_updated");

  if (stockError) {
    return NextResponse.json({ error: stockError.message }, { status: 500 });
  }

  const stockMap = new Map((stock ?? []).map((s) => [s.ingredient_id, s]));

  const rows = (ingredients ?? []).map((ing) => {
    const s = stockMap.get(ing.id);
    return {
      id: ing.id,
      name: ing.name,
      category: ing.category,
      unit: ing.unit,
      lowStockThreshold: ing.low_stock_threshold,
      isSundry: ing.is_sundry,
      qtyOnHand: s?.qty_on_hand ?? 0,
      lastUpdated: s?.last_updated ?? null,
    };
  });

  return NextResponse.json({ ingredients: rows });
}
