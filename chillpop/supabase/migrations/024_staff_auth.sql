-- ============================================================
-- Replaces the single shared ADMIN_PASSWORD gate with per-user
-- Supabase Auth + role-based access (admin / staff).
--
-- staff_users maps a Supabase Auth user (auth.users.id) to a role.
-- auth.users itself already stores email/password — this table only
-- adds what Supabase Auth doesn't: display name, role, and whether
-- the account is still allowed to sign in (deactivating here does
-- NOT delete the underlying Auth user, so it's fully reversible).
--
-- RLS: a signed-in user may read only their OWN row. That's the one
-- policy proxy.ts actually needs — it runs as the requesting user
-- (via the cookie-bound SSR client, not service_role), so it has to
-- be able to read its own role to decide what the user can access.
-- Everything else (listing all staff, creating/editing other users)
-- goes through /api/admin/settings/staff/*, which uses service_role
-- and is itself gated to admin-only by proxy.ts.
-- ============================================================

CREATE TABLE staff_users (
    id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name       VARCHAR(150) NOT NULL,
    role       VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'staff')),
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read their own staff_users row"
    ON staff_users
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);
