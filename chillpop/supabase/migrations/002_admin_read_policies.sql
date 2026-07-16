-- ============================================================
-- Read-only RLS policies for the anon key, scoped to what the
-- /admin page needs. RLS was enabled with no policies when the
-- schema was created, which silently returns zero rows for every
-- query (PostgREST returns 200 + [] rather than an error).
--
-- available_stock() is a plain plpgsql function (SECURITY INVOKER
-- by default), so it queries product_stock, production_schedules,
-- and reservations AS the calling role (anon) — those need SELECT
-- policies too, not just the two tables the page queries directly.
--
-- CAVEAT: this makes all rows in these tables readable by anyone
-- holding the anon key, which is already public in the browser
-- bundle. Fine for a no-auth internal tool; tighten (e.g. scope to
-- `authenticated` only) once login is added.
-- ============================================================

CREATE POLICY "anon can read products" ON products
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "anon can read product_stock" ON product_stock
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "anon can read reservations" ON reservations
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "anon can read production_schedules" ON production_schedules
    FOR SELECT TO anon, authenticated USING (true);
