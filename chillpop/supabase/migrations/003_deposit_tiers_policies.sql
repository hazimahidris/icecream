-- ============================================================
-- RLS policies for deposit_tiers, needed by /admin/settings/deposit-tiers.
--
-- SECURITY NOTE: UPDATE is granted to `anon` because there's no
-- auth yet. The anon key is public (shipped in the browser bundle),
-- so anyone holding it can currently rewrite deposit percentages.
-- Tighten this to `authenticated` only (and drop `anon` from the
-- USING clause) once login is added — this table controls real
-- payment logic, unlike the read-only inventory views.
-- ============================================================

CREATE POLICY "anon can read deposit_tiers" ON deposit_tiers
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "anon can update deposit_tiers" ON deposit_tiers
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
