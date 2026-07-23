-- ============================================================
-- calculate_ingredient_cost(product_id) — the single formula for
-- "how much does one piece of this flavour cost to make", used by:
--   - /admin/products (Ingredient cost/pcs, Margin % columns)
--   - the financial report's profit-by-flavour table
--   - the inventory report's wastage valuation
--   - a trigger (below) that keeps products.cost_price in sync
--
-- Sundry ingredients (is_sundry = true — salt, food colouring, things
-- tracked manually rather than by exact recipe amount) are excluded,
-- matching how they're already excluded from deduct_ingredients() and
-- generate_purchase_forecast().
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_ingredient_cost(p_product_id UUID)
RETURNS DECIMAL(12,4)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        SUM((ri.qty_per_batch::DECIMAL / ri.batch_yield) * i.cost_per_unit),
        0
    )
    FROM recipe_items ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.product_id = p_product_id
      AND i.is_sundry = false;
$$;

REVOKE EXECUTE ON FUNCTION calculate_ingredient_cost(UUID) FROM PUBLIC;

-- Keeps products.cost_price equal to calculate_ingredient_cost()
-- whenever a recipe changes — added, edited, deleted, or (the rare
-- case) reassigned to a different product.
CREATE OR REPLACE FUNCTION sync_product_cost_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE products
        SET cost_price = calculate_ingredient_cost(OLD.product_id),
            updated_at  = now(),
            updated_by  = 'system:recipe_cost_sync'
        WHERE id = OLD.product_id;
        RETURN OLD;
    END IF;

    UPDATE products
    SET cost_price = calculate_ingredient_cost(NEW.product_id),
        updated_at  = now(),
        updated_by  = 'system:recipe_cost_sync'
    WHERE id = NEW.product_id;

    -- A recipe_item switching to a different product_id is unusual,
    -- but if it happens the old product's cost is now stale too.
    IF TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
        UPDATE products
        SET cost_price = calculate_ingredient_cost(OLD.product_id),
            updated_at  = now(),
            updated_by  = 'system:recipe_cost_sync'
        WHERE id = OLD.product_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_cost_price ON recipe_items;

CREATE TRIGGER trg_sync_product_cost_price
AFTER INSERT OR UPDATE OR DELETE ON recipe_items
FOR EACH ROW
EXECUTE FUNCTION sync_product_cost_price();

-- Backfill — the trigger only fires on future recipe_items changes,
-- so without this, every product with a recipe set up before this
-- migration would stay at cost_price = 0 until its recipe is next edited.
UPDATE products SET cost_price = calculate_ingredient_cost(id);
