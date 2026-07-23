import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ProductCost = {
  name: string;
  costPerUnit: number;
};

/**
 * Ingredient cost per unit, per product — delegates to the DB function
 * calculate_ingredient_cost() (see migration 023), which is also what
 * keeps products.cost_price in sync via a trigger on recipe_items.
 * Single source of truth for this formula, used by /admin/products,
 * the financial report's profit-by-flavour table, and the inventory
 * report's wastage valuation.
 *
 * There's no manual-override path anymore — nothing in the app writes
 * a custom value to products.cost_price, so calling the function
 * directly is always at least as correct as reading the column, and
 * doesn't depend on the trigger having already run.
 */
export async function buildProductCostMap(): Promise<Map<string, ProductCost>> {
  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, name");
  if (productsError) throw new Error(productsError.message);

  const result = new Map<string, ProductCost>();

  await Promise.all(
    (products ?? []).map(async (p) => {
      const { data: cost, error } = await supabaseAdmin.rpc("calculate_ingredient_cost", {
        p_product_id: p.id,
      });
      if (error) throw new Error(error.message);

      result.set(p.id, { name: p.name, costPerUnit: Number(cost ?? 0) });
    })
  );

  return result;
}
