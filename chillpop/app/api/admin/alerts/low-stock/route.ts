import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Matches the threshold already used on /admin/inventory/stock.
const PRODUCT_LOW_STOCK_THRESHOLD = 10;

export async function GET() {
  const { data: ingredients, error: ingredientsError } = await supabaseAdmin
    .from("ingredients")
    .select("id, name, unit, low_stock_threshold")
    .eq("is_sundry", false);

  if (ingredientsError) {
    return NextResponse.json({ error: ingredientsError.message }, { status: 500 });
  }

  const { data: ingredientStock, error: ingredientStockError } = await supabaseAdmin
    .from("ingredient_stock")
    .select("ingredient_id, qty_on_hand");

  if (ingredientStockError) {
    return NextResponse.json({ error: ingredientStockError.message }, { status: 500 });
  }
  const stockMap = new Map(
    (ingredientStock ?? []).map((s) => [s.ingredient_id, Number(s.qty_on_hand)])
  );

  const ingredientAlerts = (ingredients ?? [])
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      qtyOnHand: stockMap.get(i.id) ?? 0,
      threshold: Number(i.low_stock_threshold),
    }))
    .filter((i) => i.qtyOnHand < i.threshold)
    .map((i) => ({
      ...i,
      percentRemaining: i.threshold > 0 ? i.qtyOnHand / i.threshold : 0,
    }))
    .sort((a, b) => a.percentRemaining - b.percentRemaining);

  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, name")
    .eq("is_active", true);

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  const { data: productStock, error: productStockError } = await supabaseAdmin
    .from("product_stock")
    .select("product_id, qty_on_hand");

  if (productStockError) {
    return NextResponse.json({ error: productStockError.message }, { status: 500 });
  }
  const productStockMap = new Map(
    (productStock ?? []).map((s) => [s.product_id, Number(s.qty_on_hand)])
  );

  const productAlerts = (products ?? [])
    .map((p) => ({
      id: p.id,
      name: p.name,
      qtyOnHand: productStockMap.get(p.id) ?? 0,
    }))
    .filter((p) => p.qtyOnHand < PRODUCT_LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.qtyOnHand - b.qtyOnHand);

  return NextResponse.json({
    ingredientAlerts,
    productAlerts,
    totalCount: ingredientAlerts.length + productAlerts.length,
  });
}
