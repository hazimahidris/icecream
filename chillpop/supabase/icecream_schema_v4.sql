-- ============================================================
-- ScoopOps — Ice Cream Operations System
-- Database Schema v4
-- PostgreSQL syntax
-- ============================================================
-- Key changes from v1:
-- • Stock only reserved AFTER payment verified (SRS 2.2)
-- • 9-stage order status workflow (SRS Section 3)
-- • Production Planning as first-class module
-- • Production Queue → Produced → Reserved → Delivered flow
-- • Foam Box Tracker with rental/return/deposit ledger
-- • Ingredient Purchase Forecast support
-- • Manual payment receipt upload (no gateway)
-- • Deposit tier configuration
-- • Gateway-ready fields (null for now, usable in v2)
-- ============================================================
-- Key changes from v2:
-- • created_by added to every table that has created_at
-- • updated_by added to every table that has updated_at
-- • Tables with last_updated get updated_by alongside it
-- • Tables with no timestamps get created_at + created_by
-- • Values are VARCHAR(100) — store user ID, name, or 'system'
-- • Use 'system' as the default for automated/seed actions
-- ============================================================
-- Key changes from v3 (BATCH RECIPE + CAPACITY MODEL):
-- • recipe_items redesigned for batch-based recipes:
--     qty_per_batch  — how much of this ingredient per one batch
--     batch_yield    — how many pcs one batch produces (e.g. 25)
--     is_approximate — marks "beberapa sudu" type quantities
--     is_sundry      — excludes from auto-deduction (tracked manually)
--   Deduction formula: qty_per_batch ÷ batch_yield × qty_produced
-- • products gets max_daily_qty (optional per-flavour capacity cap)
-- • production_capacity_config stays as total daily cap (unchanged)
-- • deduct_ingredients() function added — call after production_log
-- • generate_purchase_forecast() updated for batch recipe model
-- • Yam flavour seed recipe added as real example
-- ============================================================

-- ============================================================
-- 1. CATALOGUE
-- ============================================================

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,       -- Classic, Premium, Seasonal
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    name            VARCHAR(150) NOT NULL,
    unit            VARCHAR(20)  NOT NULL DEFAULT 'pcs',
    selling_price   DECIMAL(10,2) NOT NULL,
    cost_price      DECIMAL(10,2) DEFAULT 0,    -- auto-calculated from recipe, or manual
    max_daily_qty   INT DEFAULT NULL,            -- optional per-flavour cap; NULL = no limit
    is_active       BOOLEAN NOT NULL DEFAULT true,
    image_url       VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

-- ============================================================
-- 2. ADD-ONS (foam box purchase + foam box rental)
--    Foam boxes appear both as order line items AND in the
--    foam box inventory tracker — linked via addon_id.
-- ============================================================

CREATE TABLE addons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,   -- "Foam Box (Purchase)", "Foam Box (Rental)"
    type            VARCHAR(20)  NOT NULL CHECK (type IN ('purchase', 'rental')),
    price           DECIMAL(10,2) NOT NULL,
    deposit_amount  DECIMAL(10,2) DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    tracks_inventory BOOLEAN NOT NULL DEFAULT false, -- true for foam box rental units
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

-- ============================================================
-- 3. FOAM BOX TRACKER
--    Tracks individual rental units: available, rented,
--    overdue, returned, lost, deposit outstanding.
-- ============================================================

CREATE TABLE foam_box_inventory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    addon_id        UUID NOT NULL REFERENCES addons(id),
    total_units     INT NOT NULL DEFAULT 0,
    available       INT NOT NULL DEFAULT 0,
    rented          INT NOT NULL DEFAULT 0,
    overdue         INT NOT NULL DEFAULT 0,  -- past return date, not yet returned
    lost            INT NOT NULL DEFAULT 0,
    deposit_outstanding DECIMAL(10,2) NOT NULL DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE foam_box_rentals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID,                    -- FK added after orders table
    addon_id        UUID NOT NULL REFERENCES addons(id),
    qty             INT NOT NULL,
    rented_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_date        DATE NOT NULL,
    returned_at     TIMESTAMPTZ,             -- null until returned
    return_qty      INT DEFAULT 0,
    deposit_paid    DECIMAL(10,2) NOT NULL DEFAULT 0,
    deposit_refunded DECIMAL(10,2) DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'rented'
                    CHECK (status IN ('rented', 'returned', 'overdue', 'lost', 'partial_return')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

-- ============================================================
-- 4. INGREDIENTS & RECIPES
-- ============================================================

CREATE TABLE ingredients (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 VARCHAR(150) NOT NULL,
    category             VARCHAR(50),        -- dairy / flavouring / packaging / dry goods
    unit                 VARCHAR(20) NOT NULL,
    cost_per_unit        DECIMAL(10,4) NOT NULL DEFAULT 0,
    low_stock_threshold  DECIMAL(10,2) NOT NULL DEFAULT 0,
    reorder_qty          DECIMAL(10,2) DEFAULT 0, -- suggested purchase quantity
    is_sundry            BOOLEAN NOT NULL DEFAULT false,
    -- is_sundry = true — excluded from auto-deduction and purchase forecast.
    -- Use for very low-cost / approximate items like food colouring, salt.
    -- Count these manually in monthly stock-take instead.
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE ingredient_stock (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id   UUID NOT NULL UNIQUE REFERENCES ingredients(id) ON DELETE CASCADE,
    qty_on_hand     DECIMAL(12,4) NOT NULL DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE recipe_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id   UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,

    -- BATCH-BASED RECIPE MODEL
    -- Instead of qty per single unit, store the full batch quantities
    -- as written in the actual recipe, then divide by batch_yield to
    -- get the per-unit deduction at production time.
    --
    -- Example — Yam flavour (makes 25 pcs per batch):
    --   qty_per_batch = 1,  batch_yield = 25  — 1 tin susu pekat per batch
    --   qty_per_batch = 4,  batch_yield = 25  — 4 tin air per batch
    --   qty_per_batch = 3,  batch_yield = 25  — 3 sudu tepung jagung per batch
    --
    -- Deduction when producing N pcs:
    --   deducted = qty_per_batch / batch_yield * N
    --
    qty_per_batch   DECIMAL(10,4) NOT NULL,      -- how much per one full batch
    batch_yield     INT NOT NULL DEFAULT 1,       -- how many pcs one batch makes
    --                                              set to 1 if recipe is already per-unit

    is_approximate  BOOLEAN NOT NULL DEFAULT false,
    -- is_approximate = true flags "beberapa sudu / beberapa titis" quantities.
    -- The system still deducts using qty_per_batch (your best estimate),
    -- but staff can see which items have variance to expect in stock-takes.

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    UNIQUE (product_id, ingredient_id)
);

-- ============================================================
-- 5. INGREDIENT PURCHASE FORECAST
--    Supports "you need 20L milk for next week's orders"
--    rather than just a low-stock alert.
-- ============================================================

CREATE TABLE purchase_forecasts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id       UUID NOT NULL REFERENCES ingredients(id),
    forecast_date       DATE NOT NULL,         -- the date the forecast was generated
    forecast_horizon    DATE NOT NULL,         -- "for orders up to this date"
    qty_required        DECIMAL(12,4) NOT NULL,-- total needed for that horizon
    qty_on_hand         DECIMAL(12,4) NOT NULL,-- stock at time of forecast
    qty_to_purchase     DECIMAL(12,4) NOT NULL,-- recommended purchase = required - on_hand
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'ordered', 'received', 'dismissed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          VARCHAR(100) NOT NULL DEFAULT 'system'
);

-- ============================================================
-- 6. FINISHED GOODS STOCK
-- ============================================================

CREATE TABLE product_stock (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    qty_on_hand     DECIMAL(12,2) NOT NULL DEFAULT 0,  -- physically in freezer
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

-- ============================================================
-- 7. PRODUCTION PLANNING (first-class module)
--
--    Flow per SRS feedback:
--    Production Queue → In Production → Produced → (linked to reservation)
--
--    production_capacity_config: TOTAL max cups/day across all flavours.
--    Per-flavour cap (optional) is stored in products.max_daily_qty.
--    Both can be set independently:
--      - Total cap: "We can only make 400 cups on Monday in total"
--      - Per-flavour cap: "We can only make 50 Yam per day (one mould)"
--    The system respects whichever limit is hit first.
--
--    production_schedules: planned batch per flavour per date
--    production_log:       actual output — triggers ingredient deduction
-- ============================================================

CREATE TABLE production_capacity_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_of_week     INT CHECK (day_of_week BETWEEN 0 AND 7), -- 0=Sun, nullable for date override
    specific_date   DATE,                      -- overrides day_of_week if set
    max_qty         INT NOT NULL,              -- e.g. 400 cups total that day
    notes           VARCHAR(300),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    CONSTRAINT one_target CHECK (
        (day_of_week IS NOT NULL AND specific_date IS NULL) OR
        (day_of_week IS NULL AND specific_date IS NOT NULL)
    )
);

CREATE TABLE production_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id),
    scheduled_date  DATE NOT NULL,
    qty_planned     DECIMAL(12,2) NOT NULL,
    start_time      TIME,                      -- e.g. 08:00
    complete_by     TIME,                      -- e.g. 11:00
    packaging_time  TIME,                      -- e.g. 11:30
    status          VARCHAR(20) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'in_production', 'produced', 'cancelled')),
    notes           VARCHAR(300),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE production_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id         UUID REFERENCES production_schedules(id),
    product_id          UUID NOT NULL REFERENCES products(id),
    qty_produced        DECIMAL(12,2) NOT NULL,
    produced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    ingredient_deducted BOOLEAN NOT NULL DEFAULT false,
    batch_notes         VARCHAR(300),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          VARCHAR(100) NOT NULL DEFAULT 'system'  -- staff who logged this batch
);

-- ============================================================
-- 8. RESERVATIONS
--    CRITICAL: status = 'confirmed' only after payment verified.
--    Only confirmed reservations subtract from available stock.
-- ============================================================

CREATE TABLE reservations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID,                      -- FK added below after orders table
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    qty             DECIMAL(12,2) NOT NULL,
    needed_by       DATE NOT NULL,             -- pickup / delivery date
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                        'pending',             -- order placed, payment not yet verified
                        'confirmed',           -- payment verified — stock locked
                        'in_production',       -- linked to a production schedule
                        'ready',               -- produced and waiting for pickup/delivery
                        'fulfilled',           -- picked up / delivered
                        'cancelled'
                    )),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE INDEX idx_reservations_product_date
    ON reservations (product_id, needed_by)
    WHERE status = 'confirmed';

-- ============================================================
-- 9. DEPOSIT TIER CONFIGURATION
--    Configurable by admin. Used to calculate required deposit.
-- ============================================================

CREATE TABLE deposit_tiers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    min_amount      DECIMAL(10,2) NOT NULL,
    max_amount      DECIMAL(10,2),             -- null = no upper limit
    deposit_type    VARCHAR(10) NOT NULL CHECK (deposit_type IN ('full', 'percent')),
    deposit_value   DECIMAL(5,2) NOT NULL,     -- 100 for full, 50 for 50%, 30 for 30%
    label           VARCHAR(100),              -- e.g. "Below RM100 — Full payment"
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      VARCHAR(100) NOT NULL DEFAULT 'system'
);

-- Default tiers matching SRS 2.2:
INSERT INTO deposit_tiers (min_amount, max_amount, deposit_type, deposit_value, label, sort_order) VALUES
    (0,     99.99,  'full',    100, 'Below RM100 — full payment required', 1),
    (100,   500,    'percent',  50, 'RM100–RM500 — 50% deposit',           2),
    (500.01, NULL,  'percent',  30, 'Above RM500 — 30% deposit',           3);

-- ============================================================
-- 10. CUSTOMERS, DISCOUNTS, ORDERS
-- ============================================================

CREATE TABLE customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(150),
    phone       VARCHAR(30),
    email       VARCHAR(150),
    address     TEXT,
    is_guest    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE discounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) UNIQUE,            -- null for automatic bulk discounts
    type        VARCHAR(20) NOT NULL CHECK (type IN ('percent', 'flat', 'bulk_qty')),
    value       DECIMAL(10,2) NOT NULL,
    min_qty     INT,
    valid_from  DATE,
    valid_to    DATE,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
    channel             VARCHAR(10) NOT NULL CHECK (channel IN ('online', 'pos')),
    fulfilment_type     VARCHAR(10) NOT NULL CHECK (fulfilment_type IN ('pickup', 'delivery')),
    fulfilment_date     DATE NOT NULL,
    fulfilment_time     TIME,
    delivery_address    TEXT,
    remarks             TEXT,
    discount_id         UUID REFERENCES discounts(id) ON DELETE SET NULL,
    subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    total               DECIMAL(12,2) NOT NULL DEFAULT 0,

    -- Deposit tracking
    deposit_required    DECIMAL(12,2) NOT NULL DEFAULT 0,
    deposit_paid        DECIMAL(12,2) NOT NULL DEFAULT 0,
    balance_due         DECIMAL(12,2) GENERATED ALWAYS AS (total - deposit_paid) STORED,

    -- 9-stage order status (SRS Section 3)
    status              VARCHAR(30) NOT NULL DEFAULT 'draft'
                        CHECK (status IN (
                            'draft',
                            'awaiting_payment',
                            'payment_submitted',
                            'payment_verified',
                            'booking_confirmed',
                            'preparing',
                            'ready',
                            'delivered',
                            'completed',
                            'cancelled',
                            'payment_rejected',
                            'payment_expired'
                        )),

    -- Gateway-ready fields (null in v1, usable when FPX added later)
    payment_method      VARCHAR(30) DEFAULT 'manual_transfer',
    gateway_reference   VARCHAR(200),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          VARCHAR(100) NOT NULL DEFAULT 'system',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          VARCHAR(100) NOT NULL DEFAULT 'system'
);

-- Wire up the FK from reservations → orders now that orders exists
ALTER TABLE reservations
    ADD CONSTRAINT fk_reservations_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE foam_box_rentals
    ADD CONSTRAINT fk_foam_rentals_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE order_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  UUID REFERENCES products(id) ON DELETE RESTRICT,
    addon_id    UUID REFERENCES addons(id)    ON DELETE RESTRICT,
    qty         DECIMAL(12,2) NOT NULL,
    unit_price  DECIMAL(10,2) NOT NULL,        -- price locked at time of sale
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  VARCHAR(100) NOT NULL DEFAULT 'system',
    CHECK (product_id IS NOT NULL OR addon_id IS NOT NULL)
);

-- ============================================================
-- 11. MANUAL PAYMENT RECEIPTS
--     No gateway — customer uploads bank transfer receipt.
--     Admin verifies — order moves to payment_verified.
-- ============================================================

CREATE TABLE payment_receipts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    is_deposit          BOOLEAN NOT NULL DEFAULT false,
    amount_claimed      DECIMAL(12,2) NOT NULL,
    bank_name           VARCHAR(100),
    transfer_reference  VARCHAR(200),
    transfer_datetime   TIMESTAMPTZ,
    receipt_url         VARCHAR(500) NOT NULL,  -- uploaded file path
    file_type           VARCHAR(10),            -- jpg / png / pdf
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          VARCHAR(100) NOT NULL DEFAULT 'system',  -- customer or staff who submitted

    -- Admin verification
    verified_by         VARCHAR(150),
    verified_at         TIMESTAMPTZ,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN (
                            'pending',
                            'approved',
                            'rejected',
                            'request_new'
                        )),
    rejection_reason    TEXT
);

-- ============================================================
-- 12. CORE LOGIC — available stock function
--
--     available(product, date) =
--         on_hand stock
--       + production scheduled (queued/in_production) for dates <= date
--       — confirmed reservations with needed_by <= date
--
--     This function is unchanged by the batch recipe model —
--     it works in finished pcs, not ingredients.
--     Walk-in sales: use today's date — only sees physical on-hand
--     minus any reservations due today or earlier.
--     Advance booking: uses future date — includes planned production.
-- ============================================================

CREATE OR REPLACE FUNCTION available_stock(p_product_id UUID, p_date DATE)
RETURNS DECIMAL AS $$
DECLARE
    v_on_hand       DECIMAL := 0;
    v_scheduled     DECIMAL := 0;
    v_reserved      DECIMAL := 0;
BEGIN
    -- Physical finished goods in freezer right now
    SELECT COALESCE(qty_on_hand, 0) INTO v_on_hand
    FROM product_stock
    WHERE product_id = p_product_id;

    -- Planned production on or before the needed_by date
    -- (only queued or in_production — not yet completed)
    SELECT COALESCE(SUM(qty_planned), 0) INTO v_scheduled
    FROM production_schedules
    WHERE product_id = p_product_id
      AND scheduled_date <= p_date
      AND status IN ('queued', 'in_production');

    -- Confirmed reservations due on or before this date
    -- (pending reservations do NOT count — SRS 2.5)
    SELECT COALESCE(SUM(qty), 0) INTO v_reserved
    FROM reservations
    WHERE product_id = p_product_id
      AND needed_by <= p_date
      AND status IN ('confirmed', 'in_production', 'ready');

    RETURN GREATEST(v_on_hand + v_scheduled - v_reserved, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 13. INGREDIENT DEDUCTION FUNCTION (BATCH MODEL)
--
--     Call this after inserting a row into production_log.
--     Deducts ingredients from ingredient_stock based on the
--     batch recipe for that product.
--
--     Formula per ingredient:
--       deducted = (qty_per_batch / batch_yield) * qty_produced
--
--     Skips ingredients where is_sundry = true (counted manually).
--
--     Example — Yam, 25 pcs produced, batch_yield = 25:
--       Susu pekat: (1 / 25) * 25 = 1 tin deducted  ✓
--       Tepung jagung: (3 / 25) * 25 = 3 sudu deducted  ✓
--       Pewarna purple: skipped (is_sundry = true)
-- ============================================================

CREATE OR REPLACE FUNCTION deduct_ingredients(
    p_production_log_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_product_id    UUID;
    v_qty_produced  DECIMAL;
BEGIN
    -- Get the production details
    SELECT product_id, qty_produced
    INTO v_product_id, v_qty_produced
    FROM production_log
    WHERE id = p_production_log_id;

    -- Deduct each non-sundry ingredient using the batch formula
    UPDATE ingredient_stock ist
    SET
        qty_on_hand  = qty_on_hand - (ri.qty_per_batch::DECIMAL / ri.batch_yield * v_qty_produced),
        last_updated = now(),
        updated_by   = 'system:deduct_ingredients'
    FROM recipe_items ri
    JOIN ingredients ing ON ing.id = ri.ingredient_id
    WHERE ri.product_id   = v_product_id
      AND ist.ingredient_id = ri.ingredient_id
      AND ing.is_sundry   = false;

    -- Mark this production log row as deducted
    UPDATE production_log
    SET ingredient_deducted = true
    WHERE id = p_production_log_id;
END;
$$ LANGUAGE plpgsql;

-- Usage: SELECT deduct_ingredients('<production_log_id>');
-- Call this immediately after inserting into production_log,
-- or trigger it automatically — see note below.

-- OPTIONAL: Auto-trigger on production_log insert
-- Uncomment this block if you want deduction to happen automatically
-- the moment a batch is logged, without calling the function manually.
--
-- CREATE OR REPLACE FUNCTION trigger_deduct_ingredients()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     PERFORM deduct_ingredients(NEW.id);
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- CREATE TRIGGER auto_deduct_on_production
--     AFTER INSERT ON production_log
--     FOR EACH ROW
--     EXECUTE FUNCTION trigger_deduct_ingredients();

-- ============================================================
-- 14. PURCHASE FORECAST FUNCTION (updated for batch model)
--
--     For a given horizon date, calculates how much of each
--     ingredient is needed vs on hand.
--
--     Updated formula per ingredient per reservation:
--       required = (qty_per_batch / batch_yield) * reservation_qty
--
--     Sundry ingredients are excluded (is_sundry = false filter).
-- ============================================================

CREATE OR REPLACE FUNCTION generate_purchase_forecast(p_horizon_date DATE)
RETURNS TABLE (
    ingredient_id       UUID,
    ingredient_name     VARCHAR,
    unit                VARCHAR,
    is_approximate      BOOLEAN,
    qty_on_hand         DECIMAL,
    qty_required        DECIMAL,
    qty_to_purchase     DECIMAL,
    low_stock_threshold DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.id                                AS ingredient_id,
        i.name                              AS ingredient_name,
        i.unit                              AS unit,
        bool_or(ri.is_approximate)          AS is_approximate,
        COALESCE(MAX(ist.qty_on_hand), 0)   AS qty_on_hand,

        -- Batch-aware required quantity:
        -- (qty_per_batch / batch_yield) * pcs reserved = ingredient needed
        COALESCE(
            SUM((ri.qty_per_batch::DECIMAL / ri.batch_yield) * r.qty),
            0
        )                                   AS qty_required,

        GREATEST(
            COALESCE(
                SUM((ri.qty_per_batch::DECIMAL / ri.batch_yield) * r.qty),
                0
            ) - COALESCE(MAX(ist.qty_on_hand), 0),
            0
        )                                   AS qty_to_purchase,

        i.low_stock_threshold
    FROM ingredients i
    JOIN ingredient_stock ist  ON ist.ingredient_id = i.id
    LEFT JOIN recipe_items ri  ON ri.ingredient_id = i.id
    LEFT JOIN reservations r
        ON  r.product_id = ri.product_id
        AND r.needed_by  <= p_horizon_date
        AND r.status     IN ('confirmed', 'in_production')
    WHERE i.is_sundry = false    -- exclude manually-tracked sundry items
    GROUP BY i.id, i.name, i.unit, i.low_stock_threshold
    ORDER BY qty_to_purchase DESC;
END;
$$ LANGUAGE plpgsql;

-- Usage: SELECT * FROM generate_purchase_forecast('2026-07-22');
-- The is_approximate column flags ingredients where qty_per_batch
-- is an estimate — useful for staff to know which items may have
-- slight variance vs the deduction.

-- ============================================================
-- 14. SEED DATA
-- ============================================================

INSERT INTO categories (name, sort_order) VALUES
    ('Classic',  1),
    ('Special',  2),
    ('Premium', 3);

INSERT INTO products (category_id, name, unit, selling_price) VALUES
    ((SELECT id FROM categories WHERE name = 'Classic'), 'Vanilla Blue',    'pcs', 0.80),
    ((SELECT id FROM categories WHERE name = 'Classic'), 'Chocolate',  'pcs', 0.80),
    ((SELECT id FROM categories WHERE name = 'Classic'), 'Strawberry', 'pcs', 0.80),
    ((SELECT id FROM categories WHERE name = 'Special'), 'Durian Chocolate', 'pcs', 1.00),
    ((SELECT id FROM categories WHERE name = 'Special'), 'Yam Chocolate', 'pcs', 1.00),
    ((SELECT id FROM categories WHERE name = 'Premium'), 'Magnum', 'pcs', 1.20),
    ((SELECT id FROM categories WHERE name = 'Premium'), 'Tutti Fruitti', 'pcs', 1.20),
    ((SELECT id FROM categories WHERE name = 'Premium'), 'Mixed Berries', 'pcs', 1.20);

-- Initialise stock rows for every product (all start at 0)
INSERT INTO product_stock (product_id, qty_on_hand)
SELECT id, 0 FROM products;

INSERT INTO addons (name, type, price, deposit_amount, tracks_inventory) VALUES
    ('Foam Box (Purchase)', 'purchase', 3.00,  0.00, false),
    ('Foam Box (Rental)',   'rental',   1.00, 3.00, true);

INSERT INTO foam_box_inventory (addon_id, total_units, available)
SELECT id, 30, 30 FROM addons WHERE type = 'rental';

-- Add Yam to products
INSERT INTO products (category_id, name, unit, selling_price, max_daily_qty)
VALUES (
    (SELECT id FROM categories WHERE name = 'Classic'),
    'Yam', 'pcs', 0.80,
    50   -- optional cap: only 2 batches of Yam per day (50 pcs)
);

INSERT INTO product_stock (product_id, qty_on_hand)
SELECT id, 0 FROM products WHERE name = 'Yam';

-- ============================================================
-- INGREDIENTS
-- is_sundry = true  — tracked manually, excluded from auto-deduction
-- is_sundry = false — auto-deducted by deduct_ingredients()
-- ============================================================
INSERT INTO ingredients
    (name, category, unit, cost_per_unit, low_stock_threshold, reorder_qty, is_sundry)
VALUES
    -- Core dairy (auto-tracked)
    ('Susu Pekat',        'dairy',      'tin',  2.80,   6.0, 12.0, false),
    ('Susu Cair',         'dairy',      'tin',  2.20,   6.0, 12.0, false),
    -- Dry goods (auto-tracked)
    ('Gula',              'dry goods',  'kg',   1.80,   2.0,  5.0, false),
    ('Tepung Jagung',     'dry goods',  'g',    1.20, 200.0, 500.0, false),
    -- Flavourings (auto-tracked)
    ('Essen Vanilla',     'flavouring', 'ml',   0.05,  50.0, 100.0, false),
    ('Yam Cordial',       'flavouring', 'ml',   0.08,  50.0, 200.0, false),
    -- Sundry — approximate or very low cost, count monthly
    ('Garam',             'dry goods',  'g',    0.001,  0.0,   0.0, true),
    ('Purple Food Coloring',    'coloring', 'ml',   0.02,   0.0,   0.0, true),
    -- Packaging (auto-tracked)
    ('Ice Cream Plastic',               'packaging',  'pcs',  0.10, 100.0, 500.0, false),
    ('Plastic bag',             'packaging',  'pcs',  0.05, 200.0, 500.0, false),
    ('Dry Ice',           'packaging',  'kg',   3.00,   5.0,  10.0, false);

INSERT INTO ingredient_stock (ingredient_id, qty_on_hand)
SELECT id, 0 FROM ingredients;

-- ============================================================
-- RECIPE: Yam (batch_yield = 25)
-- 1 batch produces 25 pcs.
-- Quantities stored exactly as the recipe is written.
-- Deduction: qty_per_batch / 25 * qty_produced
-- ============================================================
INSERT INTO recipe_items
    (product_id, ingredient_id, qty_per_batch, batch_yield, is_approximate, created_by)
SELECT
    (SELECT id FROM products WHERE name = 'Yam'),
    i.id,
    r.qty_per_batch,
    25,
    r.is_approx,
    'seed'
FROM (VALUES
    ('Susu Pekat',     1.0,   false),  -- 1 tin per batch
    ('Susu Cair',      1.0,   false),  -- 1 tin per batch
    ('Tepung Jagung',  3.0,   false),  -- 3 sudu (≈ 30g per batch, stored in g)
    ('Gula',           0.015, false),  -- 1 sudu (≈ 15g per batch, stored in kg)
    ('Vanilla Essense',  10.0,  false),  -- 2 sudu kecil ≈ 10ml
    ('Yam Cordial',    60.0,  true),   -- beberapa sudu — standardised to 60ml, is_approximate
    ('Garam',          2.0,   false),  -- secubit ≈ 2g — is_sundry on ingredient, tracked manually
    ('Purple Food Coloring',  5.0,  true),   -- beberapa titis — ≈ 5ml, is_approximate + is_sundry
    ('Ice Cream Plastic',            25.0,  false)  -- 1 cup per pcs, 25 per batch
) AS r(ingredient_name, qty_per_batch, is_approx)
JOIN ingredients i ON i.name = r.ingredient_name;

-- ============================================================
-- RECIPE: Vanilla Blue (batch_yield = 1 — already per-unit style)
-- Kept as batch_yield = 1 so the formula still works:
-- deducted = qty_per_batch / 1 * qty_produced = qty_per_batch * qty_produced
-- ============================================================
INSERT INTO recipe_items
    (product_id, ingredient_id, qty_per_batch, batch_yield, is_approximate, created_by)
SELECT
    (SELECT id FROM products WHERE name = 'Vanilla Blue'),
    i.id,
    r.qty_per_batch,
    1,
    false,
    'seed'
FROM (VALUES
    ('Susu Pekat',     1.0,   false),  -- 1 tin per batch
    ('Susu Cair',      1.0,   false),  -- 1 tin per batch
    ('Tepung Jagung',  3.0,   false),  -- 3 sudu (≈ 30g per batch, stored in g)
    ('Gula',           0.015, false),  -- 1 sudu (≈ 15g per batch, stored in kg)
    ('Vanilla Essense',  10.0,  false),  -- 2 sudu kecil ≈ 10ml
    ('Creamy Vanilla Essense',  10.0,  false),
    ('Garam',          2.0,   false),  -- secubit ≈ 2g — is_sundry on ingredient, tracked manually
    ('Blue Food Coloring',  5.0,  true),   -- beberapa titis — ≈ 5ml, is_approximate + is_sundry
    ('Ice Cream Plastic',         1.0,  false)
) AS r(ingredient_name, qty_per_batch, is_approx)
JOIN ingredients i ON i.name = r.ingredient_name;

-- Default production capacity (Mon–Sun)
INSERT INTO production_capacity_config (day_of_week, max_qty, notes) VALUES
    (1, 75, 'Monday'),
    (2, 75, 'Tuesday'),
    (3, 75, 'Wednesday'),
    (4, 75, 'Thursday'),
    (5, 75, 'Friday — higher demand weekend prep'),
    (6, 125, 'Saturday'),
    (7, 125, 'Sunday');
