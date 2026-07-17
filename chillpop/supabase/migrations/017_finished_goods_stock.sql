-- ============================================================
-- Finished goods stock page (/admin/inventory/stock).
--
-- product_stock only holds the current qty_on_hand, same gap as
-- ingredient_stock had — this table is new, RLS enabled with zero
-- policies, all access via service_role through /api/admin/inventory/*.
--
-- One shared audit table for both "Edit" (generic adjustment) and
-- "Wastage log" (a specific kind of adjustment), since they're the
-- same underlying concern — rather than two overlapping tables.
-- Wastage's specific sub-reason (Melted/Expired/Quality reject/Other)
-- is stored in `notes`; `reason` itself is always 'wastage' for those
-- rows, keeping one clean top-level enum instead of a combined one
-- mixing generic and wastage-specific values.
-- ============================================================

CREATE TABLE product_stock_adjustments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty_before DECIMAL(12,2) NOT NULL,
    qty_after  DECIMAL(12,2) NOT NULL,
    qty_change DECIMAL(12,2) NOT NULL,
    reason     VARCHAR(30) NOT NULL
               CHECK (reason IN ('restock', 'stock_take', 'wastage', 'other')),
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(100) NOT NULL DEFAULT 'system'
);

ALTER TABLE product_stock_adjustments ENABLE ROW LEVEL SECURITY;

-- Generic "Edit" — staff sets an explicit absolute new value (e.g.
-- after a physical stock-take).
CREATE OR REPLACE FUNCTION adjust_product_stock(
    p_product_id UUID,
    p_new_qty    DECIMAL(12,2),
    p_reason     VARCHAR(30),
    p_notes      TEXT,
    p_created_by VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_qty_before    DECIMAL(12,2);
    v_adjustment_id UUID;
BEGIN
    SELECT qty_on_hand INTO v_qty_before
    FROM product_stock
    WHERE product_id = p_product_id;

    IF v_qty_before IS NULL THEN
        RAISE EXCEPTION 'Product stock record not found.';
    END IF;

    UPDATE product_stock
    SET qty_on_hand  = p_new_qty,
        last_updated = now(),
        updated_by   = p_created_by
    WHERE product_id = p_product_id;

    INSERT INTO product_stock_adjustments (
        product_id, qty_before, qty_after, qty_change, reason, notes, created_by
    ) VALUES (
        p_product_id, v_qty_before, p_new_qty, p_new_qty - v_qty_before,
        p_reason, p_notes, p_created_by
    ) RETURNING id INTO v_adjustment_id;

    RETURN v_adjustment_id;
END;
$$;

-- Wastage log — staff enters how much was wasted (a relative amount);
-- the new quantity is computed from whatever qty_on_hand actually is
-- at execution time, not a client-supplied "current" value.
CREATE OR REPLACE FUNCTION log_product_wastage(
    p_product_id     UUID,
    p_qty_wasted     DECIMAL(12,2),
    p_wastage_reason VARCHAR(100),
    p_created_by     VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_qty_before    DECIMAL(12,2);
    v_qty_after     DECIMAL(12,2);
    v_adjustment_id UUID;
BEGIN
    SELECT qty_on_hand INTO v_qty_before
    FROM product_stock
    WHERE product_id = p_product_id;

    IF v_qty_before IS NULL THEN
        RAISE EXCEPTION 'Product stock record not found.';
    END IF;

    v_qty_after := v_qty_before - p_qty_wasted;

    UPDATE product_stock
    SET qty_on_hand  = v_qty_after,
        last_updated = now(),
        updated_by   = p_created_by
    WHERE product_id = p_product_id;

    INSERT INTO product_stock_adjustments (
        product_id, qty_before, qty_after, qty_change, reason, notes, created_by
    ) VALUES (
        p_product_id, v_qty_before, v_qty_after, -p_qty_wasted,
        'wastage', p_wastage_reason, p_created_by
    ) RETURNING id INTO v_adjustment_id;

    RETURN v_adjustment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION adjust_product_stock(UUID, DECIMAL, VARCHAR, TEXT, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION log_product_wastage(UUID, DECIMAL, VARCHAR, VARCHAR) FROM PUBLIC;
