-- ============================================================
-- Public read access for the customer-facing catalogue (/order).
--
-- categories has no SELECT policy yet. Without it, embedding
-- categories(name) in the /order products query returns null for
-- every row — RLS silently strips the joined table rather than
-- erroring, same pattern as the earlier empty-table issue.
-- ============================================================

CREATE POLICY "anon can read categories" ON categories
    FOR SELECT TO anon, authenticated USING (true);
