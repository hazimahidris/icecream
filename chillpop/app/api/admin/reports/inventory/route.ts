import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildProductCostMap } from "@/lib/productCost";

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

  // ---------- shared lookups ----------
  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (productsError) return NextResponse.json({ error: productsError.message }, { status: 500 });

  // Still needed separately from the cost map below — this recomputes
  // theoretical ingredient deduction (Section 3), unrelated to cost.
  const { data: recipeItems, error: recipeError } = await supabaseAdmin
    .from("recipe_items")
    .select("product_id, ingredient_id, qty_per_batch, batch_yield");
  if (recipeError) return NextResponse.json({ error: recipeError.message }, { status: 500 });

  let productCostMap;
  try {
    productCostMap = await buildProductCostMap();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // ---------- Section 1: stock movement summary ----------
  const { data: stockRows, error: stockError } = await supabaseAdmin
    .from("product_stock")
    .select("product_id, qty_on_hand");
  if (stockError) return NextResponse.json({ error: stockError.message }, { status: 500 });
  const currentStockMap = new Map((stockRows ?? []).map((s) => [s.product_id, Number(s.qty_on_hand)]));

  const { data: productionRows, error: productionError } = await supabaseAdmin
    .from("production_log")
    .select("product_id, qty_produced")
    .gte("produced_at", startTs)
    .lt("produced_at", endExclusiveTs);
  if (productionError) return NextResponse.json({ error: productionError.message }, { status: 500 });
  const producedMap = new Map<string, number>();
  for (const r of productionRows ?? []) {
    producedMap.set(r.product_id, (producedMap.get(r.product_id) ?? 0) + Number(r.qty_produced));
  }

  const { data: posOrders, error: posOrdersError } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("channel", "pos")
    .gte("created_at", startTs)
    .lt("created_at", endExclusiveTs);
  if (posOrdersError) return NextResponse.json({ error: posOrdersError.message }, { status: 500 });
  const posOrderIds = (posOrders ?? []).map((o) => o.id);

  const soldPosMap = new Map<string, number>();
  if (posOrderIds.length > 0) {
    const { data: posItems, error: posItemsError } = await supabaseAdmin
      .from("order_items")
      .select("product_id, qty")
      .in("order_id", posOrderIds)
      .not("product_id", "is", null);
    if (posItemsError) return NextResponse.json({ error: posItemsError.message }, { status: 500 });
    for (const it of posItems ?? []) {
      if (!it.product_id) continue;
      soldPosMap.set(it.product_id, (soldPosMap.get(it.product_id) ?? 0) + Number(it.qty));
    }
  }

  // Online sales use delivered_at (when mark_order_fulfilled() actually
  // deducted product_stock) — not created_at, which is when the order
  // was placed, potentially long before fulfilment.
  const { data: onlineOrders, error: onlineOrdersError } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("channel", "online")
    .gte("delivered_at", startTs)
    .lt("delivered_at", endExclusiveTs);
  if (onlineOrdersError) {
    return NextResponse.json({ error: onlineOrdersError.message }, { status: 500 });
  }
  const onlineOrderIds = (onlineOrders ?? []).map((o) => o.id);

  const soldOnlineMap = new Map<string, number>();
  if (onlineOrderIds.length > 0) {
    const { data: onlineItems, error: onlineItemsError } = await supabaseAdmin
      .from("order_items")
      .select("product_id, qty")
      .in("order_id", onlineOrderIds)
      .not("product_id", "is", null);
    if (onlineItemsError) {
      return NextResponse.json({ error: onlineItemsError.message }, { status: 500 });
    }
    for (const it of onlineItems ?? []) {
      if (!it.product_id) continue;
      soldOnlineMap.set(it.product_id, (soldOnlineMap.get(it.product_id) ?? 0) + Number(it.qty));
    }
  }

  const { data: wastageRows, error: wastageError } = await supabaseAdmin
    .from("product_stock_adjustments")
    .select("id, product_id, qty_change, notes, created_at, created_by")
    .eq("reason", "wastage")
    .gte("created_at", startTs)
    .lt("created_at", endExclusiveTs)
    .order("created_at", { ascending: false });
  if (wastageError) return NextResponse.json({ error: wastageError.message }, { status: 500 });

  const wastedMap = new Map<string, number>();
  for (const w of wastageRows ?? []) {
    wastedMap.set(w.product_id, (wastedMap.get(w.product_id) ?? 0) + Math.abs(Number(w.qty_change)));
  }

  // Closing stock is CURRENT qty_on_hand — the system has no dated
  // stock ledger, so this is only exact when `end` is today. Opening
  // is derived algebraically from closing and this period's logged
  // movements: opening + produced - sold - wasted = closing.
  const stockMovement = (products ?? []).map((p) => {
    const produced = producedMap.get(p.id) ?? 0;
    const soldPos = soldPosMap.get(p.id) ?? 0;
    const soldOnline = soldOnlineMap.get(p.id) ?? 0;
    const soldTotal = soldPos + soldOnline;
    const wasted = wastedMap.get(p.id) ?? 0;
    const closing = currentStockMap.get(p.id) ?? 0;
    const opening = closing - produced + soldTotal + wasted;

    return {
      productId: p.id,
      name: p.name,
      opening,
      produced,
      soldPos,
      soldOnline,
      soldTotal,
      wasted,
      closing,
    };
  });

  // ---------- Section 2: wastage log ----------
  const wastageLog = (wastageRows ?? []).map((w) => {
    const qty = Math.abs(Number(w.qty_change));
    const value = qty * (productCostMap.get(w.product_id)?.costPerUnit ?? 0);
    return {
      id: w.id,
      date: w.created_at,
      flavourName: productCostMap.get(w.product_id)?.name ?? "Unknown",
      qty,
      reason: w.notes ?? "-",
      recordedBy: w.created_by,
      value,
    };
  });
  const totalWastageValue = wastageLog.reduce((sum, w) => sum + w.value, 0);

  // ---------- Section 3: ingredient usage vs purchased ----------
  const { data: ingredients, error: ingredientsError } = await supabaseAdmin
    .from("ingredients")
    .select("id, name, unit")
    .eq("is_sundry", false);
  if (ingredientsError) return NextResponse.json({ error: ingredientsError.message }, { status: 500 });

  const { data: deductedProductionRows, error: deductedProductionError } = await supabaseAdmin
    .from("production_log")
    .select("product_id, qty_produced")
    .eq("ingredient_deducted", true)
    .gte("produced_at", startTs)
    .lt("produced_at", endExclusiveTs);
  if (deductedProductionError) {
    return NextResponse.json({ error: deductedProductionError.message }, { status: 500 });
  }

  // Recompute the theoretical deduction the same way deduct_ingredients()
  // itself does — there's no per-ingredient audit row for it, only the
  // production_log rows it was derived from.
  const deductedMap = new Map<string, number>();
  for (const log of deductedProductionRows ?? []) {
    for (const ri of recipeItems ?? []) {
      if (ri.product_id !== log.product_id) continue;
      const perUnit = Number(ri.qty_per_batch) / Number(ri.batch_yield);
      deductedMap.set(
        ri.ingredient_id,
        (deductedMap.get(ri.ingredient_id) ?? 0) + perUnit * Number(log.qty_produced)
      );
    }
  }

  const { data: restockRows, error: restockError } = await supabaseAdmin
    .from("ingredient_stock_adjustments")
    .select("ingredient_id, qty_change")
    .eq("reason", "restock")
    .gte("created_at", startTs)
    .lt("created_at", endExclusiveTs);
  if (restockError) return NextResponse.json({ error: restockError.message }, { status: 500 });

  const restockedMap = new Map<string, number>();
  for (const r of restockRows ?? []) {
    restockedMap.set(r.ingredient_id, (restockedMap.get(r.ingredient_id) ?? 0) + Number(r.qty_change));
  }

  const ingredientUsage = (ingredients ?? [])
    .map((i) => {
      const deducted = deductedMap.get(i.id) ?? 0;
      const restocked = restockedMap.get(i.id) ?? 0;
      return {
        ingredientId: i.id,
        name: i.name,
        unit: i.unit,
        deducted,
        restocked,
        variance: restocked - deducted,
      };
    })
    .filter((row) => row.deducted > 0 || row.restocked > 0);

  return NextResponse.json({
    range: { start, end },
    stockMovement,
    wastageLog,
    totalWastageValue,
    ingredientUsage,
  });
}
