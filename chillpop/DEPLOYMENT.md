# Deployment Checklist

## Environment variables to add in Vercel

Every variable currently in `.env.local` needs to be added to the Vercel
project (Settings → Environment Variables) before deploying — Vercel does
not read `.env.local`, and it's gitignored anyway.

### Public (safe to expose to the browser — `NEXT_PUBLIC_` prefix required)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_BANK_NAME`
- `NEXT_PUBLIC_ACCOUNT_NAME`
- `NEXT_PUBLIC_ACCOUNT_NUMBER`
- `NEXT_PUBLIC_BUSINESS_NAME`
- `NEXT_PUBLIC_BUSINESS_PHONE`
- `NEXT_PUBLIC_BUSINESS_WHATSAPP`
- `NEXT_PUBLIC_BUSINESS_ADDRESS` — **still a placeholder locally, fill in the real address before deploying**
- `NEXT_PUBLIC_BUSINESS_HOURS`

### Secret (server-only — never prefix with `NEXT_PUBLIC_`)
- `ADMIN_PASSWORD` — gates all `/admin/*` routes
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS entirely; treat as full DB access
- `RESEND_API_KEY`
- `EMAIL_FROM` — confirm this is a domain verified in your Resend account before relying on it in production (a bare `gmail.com` address will likely fail to send — see note below)

## Other things to check before/at deploy time

- **Resend sending domain**: `EMAIL_FROM` currently points at a personal Gmail address. Resend requires the `from` domain to be verified (DNS records added in the Resend dashboard). Verify a real domain or switch to Resend's own test sender before go-live, or booking confirmation emails will silently fail (errors are only logged server-side, never surfaced to the admin).
- **Supabase migrations**: confirm all files in `supabase/migrations/` (001–011 as of now) have been run against the production Supabase project, not just your dev project — this repo doesn't auto-run them.
- **Storage bucket**: confirm the `receipts` bucket exists in the production Supabase project with `public = false` (migration `009` creates it, but only if run against that project).
- **`ADMIN_PASSWORD`**: use a real, unique password for production — not `abc123`.

## Auth (tracked separately)

`/admin/*` is currently a single shared password gate, not real per-user auth. See the "Admin auth" section in `CLAUDE.md` — Phase 4 replaces this with Supabase Auth + role-based access + an audit log. Not a blocker for an initial deploy, but don't treat the shared password as long-term access control.
