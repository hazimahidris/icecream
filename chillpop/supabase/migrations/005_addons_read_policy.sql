-- ============================================================
-- Public read access for the add-ons step of the order form
-- (/order/[productId], Step 5). Same missing-policy pattern as
-- categories/deposit_tiers before it.
-- ============================================================

CREATE POLICY "anon can read addons" ON addons
    FOR SELECT TO anon, authenticated USING (true);
