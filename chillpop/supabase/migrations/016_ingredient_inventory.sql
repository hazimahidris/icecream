-- ============================================================
-- Ingredient inventory page (/admin/inventory/ingredients).
--
-- ingredient_stock only ever holds the CURRENT qty_on_hand — there's
-- nowhere in the original schema to record a history of manual
-- adjustments (restock, stock-take correction, wastage, etc.), which
-- the spec explicitly calls "the audit trail". This table is new.
--
-- RLS is enabled with zero policies, same as every other table in
-- this project — all access goes through service_role via
-- /api/admin/inventory/*, gated by the existing proxy.ts matcher.
-- ============================================================

CREATE TABLE ingredient_stock_adjustments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    qty_before    DECIMAL(12,4) NOT NULL,
    qty_after     DECIMAL(12,4) NOT NULL,
    qty_change    DECIMAL(12,4) NOT NULL,
    reason        VARCHAR(30) NOT NULL
                  CHECK (reason IN ('restock', 'stock_take', 'wastage', 'other')),
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    VARCHAR(100) NOT NULL DEFAULT 'system'
);

ALTER TABLE ingredient_stock_adjustments ENABLE ROW LEVEL SECURITY;

-- Updates ingredient_stock and writes the audit record in one
-- transaction — a failure partway through can't leave a stock change
-- with no corresponding audit entry (or vice versa).
CREATE OR REPLACE FUNCTION adjust_ingredient_stock(
    p_ingredient_id UUID,
    p_new_qty       DECIMAL(12,4),
    p_reason        VARCHAR(30),
    p_notes         TEXT,
    p_created_by    VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_qty_before    DECIMAL(12,4);
    v_adjustment_id UUID;
BEGIN
    SELECT qty_on_hand INTO v_qty_before
    FROM ingredient_stock
    WHERE ingredient_id = p_ingredient_id;

    IF v_qty_before IS NULL THEN
        RAISE EXCEPTION 'Ingredient stock record not found.';
    END IF;

    UPDATE ingredient_stock
    SET qty_on_hand  = p_new_qty,
        last_updated = now(),
        updated_by   = p_created_by
    WHERE ingredient_id = p_ingredient_id;

    INSERT INTO ingredient_stock_adjustments (
        ingredient_id, qty_before, qty_after, qty_change, reason, notes, created_by
    ) VALUES (
        p_ingredient_id, v_qty_before, p_new_qty, p_new_qty - v_qty_before,
        p_reason, p_notes, p_created_by
    ) RETURNING id INTO v_adjustment_id;

    RETURN v_adjustment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION adjust_ingredient_stock(UUID, DECIMAL, VARCHAR, TEXT, VARCHAR) FROM PUBLIC;
