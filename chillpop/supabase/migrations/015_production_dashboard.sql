-- ============================================================
-- Support for /admin/production.
--
-- Both functions follow the established pattern: called only from
-- Next.js Route Handlers using the service_role key, REVOKEd from
-- PUBLIC so the anon key can't call them directly (Postgres grants
-- EXECUTE on new functions to PUBLIC by default — this has bitten
-- earlier migrations in this project when the REVOKE was forgotten).
--
-- todays_ingredient_pull() is LANGUAGE sql (a straight query, no
-- procedural logic), which sidesteps a real bug class found while
-- building pos_checkout(): RETURNS TABLE(...) creates PL/pgSQL
-- variables matching the output column names, and any *unqualified*
-- reference to a same-named table column inside a plpgsql function
-- body becomes ambiguous. A pure SQL function has no such variable
-- scope, so this is safe even though its output columns
-- (ingredient_id) could otherwise collide with query aliases.
-- ============================================================

CREATE OR REPLACE FUNCTION todays_ingredient_pull(p_date DATE)
RETURNS TABLE (
    ingredient_id UUID,
    name          VARCHAR,
    unit          VARCHAR,
    qty_needed    DECIMAL,
    qty_on_hand   DECIMAL
)
LANGUAGE sql
SET search_path = public
AS $$
    SELECT
        ri.ingredient_id,
        i.name,
        i.unit,
        SUM((ri.qty_per_batch::decimal / ri.batch_yield) * ps.qty_planned) AS qty_needed,
        COALESCE(MAX(ist.qty_on_hand), 0) AS qty_on_hand
    FROM production_schedules ps
    JOIN recipe_items ri ON ri.product_id = ps.product_id
    JOIN ingredients i ON i.id = ri.ingredient_id
    LEFT JOIN ingredient_stock ist ON ist.ingredient_id = ri.ingredient_id
    WHERE ps.scheduled_date = p_date
      AND ps.status IN ('queued', 'in_production')
      AND i.is_sundry = false
    GROUP BY ri.ingredient_id, i.name, i.unit;
$$;

REVOKE EXECUTE ON FUNCTION todays_ingredient_pull(DATE) FROM PUBLIC;

-- "Mark as Produced": log -> deduct ingredients (reuses the existing
-- deduct_ingredients() from the original schema) -> add to finished
-- goods stock -> flip the schedule to 'produced'. One call, one
-- transaction — a failure partway through (e.g. deduct_ingredients
-- erroring) rolls back the production_log insert too, rather than
-- leaving a log entry with no corresponding stock changes.
CREATE OR REPLACE FUNCTION mark_production_produced(
    p_schedule_id  UUID,
    p_qty_produced DECIMAL(12,2),
    p_created_by   VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_product_id UUID;
    v_log_id     UUID;
BEGIN
    SELECT product_id INTO v_product_id
    FROM production_schedules
    WHERE id = p_schedule_id;

    IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'Production schedule not found.';
    END IF;

    -- 1. Log the batch.
    INSERT INTO production_log (schedule_id, product_id, qty_produced, produced_at, created_by)
    VALUES (p_schedule_id, v_product_id, p_qty_produced, now(), p_created_by)
    RETURNING production_log.id INTO v_log_id;

    -- 2. Deduct ingredients (existing function from the base schema).
    PERFORM deduct_ingredients(v_log_id);

    -- 3. Add to finished-goods stock.
    UPDATE product_stock
    SET qty_on_hand  = qty_on_hand + p_qty_produced,
        last_updated = now(),
        updated_by   = p_created_by
    WHERE product_id = v_product_id;

    -- 4. Schedule is done.
    UPDATE production_schedules
    SET status = 'produced', updated_by = p_created_by
    WHERE id = p_schedule_id;

    RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_production_produced(UUID, DECIMAL, VARCHAR) FROM PUBLIC;
