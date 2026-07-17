-- ============================================================
-- Purchase forecast page (/admin/purchasing/forecast).
--
-- generate_purchase_forecast() and purchase_forecasts already exist
-- in the base schema — this migration just adds the one RPC "Mark as
-- Received" needs (updating ingredient_stock and purchase_forecasts
-- together, plus an audit row via the existing
-- ingredient_stock_adjustments table from migration 016, reason
-- 'restock'), and locks down execute permissions that were never
-- revoked from PUBLIC when the base schema was written.
-- ============================================================

REVOKE EXECUTE ON FUNCTION generate_purchase_forecast(DATE) FROM PUBLIC;

CREATE OR REPLACE FUNCTION mark_purchase_received(
    p_forecast_id  UUID,
    p_qty_received DECIMAL(12,4),
    p_created_by   VARCHAR(100)
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_forecast   purchase_forecasts%ROWTYPE;
    v_qty_before DECIMAL(12,4);
    v_qty_after  DECIMAL(12,4);
BEGIN
    SELECT * INTO v_forecast FROM purchase_forecasts WHERE id = p_forecast_id FOR UPDATE;

    IF v_forecast.id IS NULL THEN
        RAISE EXCEPTION 'Purchase forecast record not found.';
    END IF;
    IF v_forecast.status <> 'ordered' THEN
        RAISE EXCEPTION 'This purchase is not marked as ordered.';
    END IF;
    IF p_qty_received IS NULL OR p_qty_received <= 0 THEN
        RAISE EXCEPTION 'Enter a valid quantity received.';
    END IF;

    SELECT qty_on_hand INTO v_qty_before
    FROM ingredient_stock
    WHERE ingredient_id = v_forecast.ingredient_id;

    IF v_qty_before IS NULL THEN
        RAISE EXCEPTION 'Ingredient stock record not found.';
    END IF;

    v_qty_after := v_qty_before + p_qty_received;

    UPDATE ingredient_stock
    SET qty_on_hand  = v_qty_after,
        last_updated = now(),
        updated_by   = p_created_by
    WHERE ingredient_id = v_forecast.ingredient_id;

    INSERT INTO ingredient_stock_adjustments (
        ingredient_id, qty_before, qty_after, qty_change, reason, notes, created_by
    ) VALUES (
        v_forecast.ingredient_id, v_qty_before, v_qty_after, p_qty_received,
        'restock', 'Purchase order received', p_created_by
    );

    UPDATE purchase_forecasts
    SET status     = 'received',
        updated_at = now(),
        updated_by = p_created_by
    WHERE id = p_forecast_id;

    RETURN p_forecast_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_purchase_received(UUID, DECIMAL, VARCHAR) FROM PUBLIC;
