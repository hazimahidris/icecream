import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select(
      "id, name, unit, selling_price, max_daily_qty, image_url, is_active, category_id, categories ( name )"
    )
    .order("name");

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  const rows = products ?? [];

  // calculate_ingredient_cost() per product, per the spec — kept as
  // individual RPC calls (not a batch query) since this is also the
  // authoritative single source of truth used by the financial and
  // inventory reports (see lib/productCost.ts).
  //
  // A failed RPC call must surface as a real error, not silently
  // become cost=0 — that specific value means "no recipe set", which
  // is a legitimate result, not the same thing as "the call failed".
  const costEntries: (readonly [string, number])[] = [];
  for (const p of rows) {
    const { data, error } = await supabaseAdmin.rpc("calculate_ingredient_cost", {
      p_product_id: p.id,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    costEntries.push([p.id, Number(data ?? 0)] as const);
  }
  const costMap = new Map(costEntries);

  const { data: categories, error: categoriesError } = await supabaseAdmin
    .from("categories")
    .select("id, name")
    .order("sort_order");

  if (categoriesError) {
    return NextResponse.json({ error: categoriesError.message }, { status: 500 });
  }

  const result = rows.map((p) => {
    const category = Array.isArray(p.categories) ? p.categories[0] : p.categories;
    const ingredientCost = costMap.get(p.id) ?? 0;
    const sellingPrice = Number(p.selling_price);
    const marginPct =
      ingredientCost > 0 && sellingPrice > 0
        ? ((sellingPrice - ingredientCost) / sellingPrice) * 100
        : null;

    return {
      id: p.id,
      name: p.name,
      unit: p.unit,
      categoryId: p.category_id,
      categoryName: category?.name ?? null,
      sellingPrice,
      ingredientCost,
      marginPct,
      maxDailyQty: p.max_daily_qty,
      imageUrl: p.image_url,
      isActive: p.is_active,
    };
  });

  return NextResponse.json({ products: result, categories: categories ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const categoryId = typeof body?.categoryId === "string" && body.categoryId ? body.categoryId : null;
  const sellingPrice = Number(body?.sellingPrice ?? NaN);
  const imageUrl = typeof body?.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  const maxDailyQty =
    body?.maxDailyQty === null || body?.maxDailyQty === undefined || body?.maxDailyQty === ""
      ? null
      : Number(body.maxDailyQty);

  if (!name) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }
  if (Number.isNaN(sellingPrice) || sellingPrice <= 0) {
    return NextResponse.json({ error: "Enter a valid selling price." }, { status: 400 });
  }
  if (maxDailyQty !== null && (Number.isNaN(maxDailyQty) || maxDailyQty < 0)) {
    return NextResponse.json({ error: "Enter a valid max daily qty." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("products")
    .insert({
      name,
      category_id: categoryId,
      selling_price: sellingPrice,
      image_url: imageUrl,
      max_daily_qty: maxDailyQty,
      created_by: "admin",
      updated_by: "admin",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Finished-goods stock (Section 6 of the schema) needs a matching
  // row for every product — mirrors the seed data's
  // "INSERT INTO product_stock ... SELECT id, 0 FROM products" pattern.
  const { error: stockError } = await supabaseAdmin
    .from("product_stock")
    .insert({ product_id: data.id, qty_on_hand: 0, created_by: "admin", updated_by: "admin" });

  if (stockError) {
    return NextResponse.json({ error: stockError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
