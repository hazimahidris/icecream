-- ============================================================
-- Migration: convert all TIMESTAMP columns to TIMESTAMPTZ
-- Run once against the existing icecream_schema_v4 tables.
-- Safe to re-run: altering an already-TIMESTAMPTZ column to
-- TIMESTAMPTZ again is a no-op.
--
-- Existing values are assumed to have been written by a server
-- running in UTC (Supabase default), so `AT TIME ZONE 'UTC'`
-- reattaches the correct offset without shifting the stored
-- instant.
-- ============================================================

ALTER TABLE categories
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE products
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE addons
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE foam_box_inventory
    ALTER COLUMN last_updated TYPE TIMESTAMPTZ USING last_updated AT TIME ZONE 'UTC',
    ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE foam_box_rentals
    ALTER COLUMN rented_at   TYPE TIMESTAMPTZ USING rented_at AT TIME ZONE 'UTC',
    ALTER COLUMN returned_at TYPE TIMESTAMPTZ USING returned_at AT TIME ZONE 'UTC',
    ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at  TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE ingredients
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE ingredient_stock
    ALTER COLUMN last_updated TYPE TIMESTAMPTZ USING last_updated AT TIME ZONE 'UTC',
    ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE recipe_items
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE purchase_forecasts
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE product_stock
    ALTER COLUMN last_updated TYPE TIMESTAMPTZ USING last_updated AT TIME ZONE 'UTC',
    ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE production_capacity_config
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE production_schedules
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE production_log
    ALTER COLUMN produced_at TYPE TIMESTAMPTZ USING produced_at AT TIME ZONE 'UTC',
    ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE reservations
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE deposit_tiers
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE customers
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE discounts
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE orders
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE order_items
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE payment_receipts
    ALTER COLUMN transfer_datetime TYPE TIMESTAMPTZ USING transfer_datetime AT TIME ZONE 'UTC',
    ALTER COLUMN submitted_at      TYPE TIMESTAMPTZ USING submitted_at AT TIME ZONE 'UTC',
    ALTER COLUMN verified_at       TYPE TIMESTAMPTZ USING verified_at AT TIME ZONE 'UTC';
