@AGENTS.md

# ChillPop

## What this is
- Ice cream ordering + POS + inventory management system
- Covers: product catalogue, ingredient & finished-goods stock, production planning, reservations, deposit-based payments, foam box rental tracking

## Tech stack
- Next.js (App Router) + TypeScript
- Tailwind CSS
- Supabase (PostgreSQL) via `@supabase/supabase-js`, anon key in `.env.local`
- Deployed on Vercel

## Core rule
- Stock is reserved only **after payment is verified** — never at order submission.
  - Reservations are created with status `pending` at order submission (`place_order` RPC).
  - Reservations move to `confirmed` only when an admin approves the payment receipt (`approve_payment_receipt` RPC, called from `/admin/payments`) — this is the moment stock actually becomes reserved, not before.
  - `pending` reservations do not subtract from available stock.

## `available_stock(product, date)` formula
```
available =
    on_hand stock (product_stock.qty_on_hand)
  + production scheduled on/before date (production_schedules, status queued/in_production)
  - confirmed reservations due on/before date (status confirmed/in_production/ready)
```
Floored at 0.

## Known inconsistency — `/admin/inventory/stock` "Reserved" column
The "Reserved" column on the finished-goods stock page (`app/api/admin/inventory/stock/route.ts`)
sums confirmed/in_production/ready reservations with `needed_by >= today` — i.e. **all
outstanding demand from today onward**, not just what's due today.

This is a different time slice than what `available_stock()` actually deducts (reservations
with `needed_by <= today`, i.e. due today or overdue). So "Reserved" and "Available" on that
page don't explain each other — e.g. a product can show a large Reserved number while Available
is high too, because most of that reserved qty is due next week, not today.

If this becomes confusing in practice, change the filter in that route from
`.gte("needed_by", today)` to `.lte("needed_by", today)` so Reserved matches exactly what
Available subtracts, giving: `Available = On Hand + Today's Scheduled Production − Reserved`.
Left as-is for now at the user's request (2026-07-17).

## Foam box tracker — two deliberate decisions
1. `deposit_outstanding` on `foam_box_inventory` only decreases when a rental
   fully closes (status reaches `'returned'`) — not on intermediate partial
   returns. This prevents double-subtraction. While a rental is in
   `partial_return` state, full deposit still shows as outstanding intentionally.

2. Overdue count and row highlighting use: `due_date < today AND status = 'rented'`
   `partial_return` status is excluded from overdue — customer has engaged,
   outstanding boxes tracked separately.

## Financial report design decisions
- Cost source: `products.cost_price` if set and > 0, otherwise
  auto-calculated from `recipe_items` × `ingredient.cost_per_unit`.
  Each row shows which source was used.
- Fulfilled orders = `status IN ('delivered', 'completed')` only.
- Period filter uses `created_at` for consistency with the sales report.
- Sections 2 (outstanding payments) and 3 (deposit ledger) are
  current-state snapshots — intentionally not period-scoped.
  Do not change this behaviour.

## Reporting layer — known data gaps (V2 backlog)
1. **No stock movement audit trail.** `product_stock` and `ingredient_stock`
   are overwritten in place by production, POS sales, and online-order
   fulfilment — only *manual* adjustments are logged (via
   `product_stock_adjustments` / `ingredient_stock_adjustments`).
   Fix: a `stock_movements` table, append-only.
2. **No ingredient deduction audit trail.** `deduct_ingredients()` writes
   straight to `ingredient_stock.qty_on_hand` with no per-ingredient
   record of what it deducted or why. Fix: an `ingredient_movements`
   table, one row per deduction with a `production_log_id` FK.
3. **`products.cost_price` defaults to 0 and nothing in the app ever
   writes to it** — cost always falls back to the recipe calculation
   (see `lib/productCost.ts`). Fix: auto-populate `cost_price` from the
   recipe on product save, or add a scheduled recalculation job.
4. ~~Shared cost-source fallback logic duplicated between the financial
   report and the wastage calculation.~~ **Done** — extracted to
   `lib/productCost.ts` (`buildProductCostMap()`), used by both
   `/admin/reports/financial` and `/admin/reports/inventory`.

Until 1–3 are addressed, historical reports for date ranges not ending
today should be treated as **estimates, not exact figures** — e.g. the
stock movement report (`/admin/reports/inventory`) derives "opening"
algebraically (`opening = closing − produced + sold + wasted`), where
"closing" is always *current* `qty_on_hand`, not a dated snapshot.

## Build status

### Phase 1 — complete
Schema loaded (`icecream_schema_v4.sql`), allocation logic (`available_stock`, `deduct_ingredients`) tested.

### Phase 2 — complete
Customer website, order flow, payment upload, admin verification.

Pages built:
- `/order` — product catalogue, grouped by category
- `/order/[id]` — order builder (Flavour → Order Details → Your Details → Review & Confirm)
- `/order/[id]/payment` — payment instructions, DuitNow QR, receipt upload
- `/order/track` — order tracking by Order ID + mobile number
- `/admin` — stock and reservation overview
- `/admin/settings/deposit-tiers` — deposit tier editor
- `/admin/payments` — payment verification (Pending / Recently Approved tabs; approve, reject, request new receipt)
- `/admin/login` — admin login (Supabase Auth email/password — see "Admin auth" below; this replaced an original single shared password gate)

Integrations:
- Resend sends the booking confirmation email on payment approval (`RESEND_API_KEY`, `EMAIL_FROM` in `.env.local`) — see `lib/sendBookingConfirmation.ts`
- DuitNow QR code is a static asset at `public/duitnow-qr.jpeg`

### Phase 3 — complete
POS, production planning, booking calendar, inventory management, purchasing, order fulfilment.

Pages built:
- `/admin/pos` — point of sale checkout
- `/admin/pos/receipt/[orderId]` — POS receipt
- `/admin/calendar` — booking calendar
- `/admin/production` — production dashboard (today's ingredient pull, Mark as Produced)
- `/admin/production/schedule` — production schedule management + capacity config
- `/admin/inventory/ingredients` — ingredient inventory, manual stock adjustments
- `/admin/inventory/stock` — finished goods stock, wastage log
- `/admin/inventory/foam-boxes` — foam box rental tracker (upcoming handouts, active rentals, returns, loss, deposit refunds)
- `/admin/purchasing/forecast` — purchase forecast (7/14-day horizon), mark ordered/received
- `/admin/orders` — order status management (Kanban: Booking Confirmed → Preparing → Ready → Delivered → Completed, plus cancel)

Also added: a low-stock alert bell in the shared admin layout (`app/admin/layout.tsx`), polling ingredient and finished-goods stock every 5 minutes.

Key behaviors from Phase 3:
- **POS reservations are `fulfilled` immediately, not `confirmed`.** `pos_checkout()` inserts each line's reservation with status `fulfilled` (not `pending` → `confirmed` like online orders) — a POS sale is an instant handover, so there's no reservation lifecycle to move through. (This corrects an earlier assumption — migration 013 initially inserted these as `confirmed`, which double-counted against `available_stock()` since that function also subtracts confirmed reservations on top of the direct stock deduction below; migration 014 fixed it by switching to `fulfilled`, which `available_stock()` doesn't subtract.)
- **`product_stock` is deducted at two points only: POS checkout, and online-order fulfilment** — never at reservation creation. `pos_checkout()` deducts immediately (instant handover). For online orders, `place_order` and `approve_payment_receipt` never touch `product_stock` — the deduction happens later, in `mark_order_fulfilled()` (called from the "Mark Delivered"/"Mark Picked Up" button on `/admin/orders`), gated to `channel = 'online'` only so POS orders (already deducted at checkout) are never double-deducted.
- **`deduct_ingredients()` only runs from `mark_production_produced()`** — the "Mark as Produced" action on `/admin/production`. Nothing else calls it; ingredient stock never moves except through that one path (plus manual adjustments on `/admin/inventory/ingredients`).
- **Foam box deposits are manual, no auto-refund.** `refund_foam_box_deposit()` always requires a staff-entered amount via the "Refund Deposit" action — nothing in the system ever refunds a deposit automatically, including on return or loss (a lost rental's deposit is explicitly forfeited and left untouched — see the Foam box tracker section above).

### Phase 4 — in progress
Reporting (complete), discounts engine (complete), proper auth (complete —
see "Admin auth" below), final testing and go-live (remaining).

## Admin auth
Per-user Supabase Auth with role-based access, replacing the original
single shared `ADMIN_PASSWORD` cookie gate (migration 024).

- `staff_users` maps a Supabase Auth user (`auth.users.id`) to a role
  (`admin` | `staff`) and an `is_active` flag. Deactivating here does
  **not** delete the underlying Auth account — it's fully reversible,
  and `proxy.ts` checks `is_active` on every request (not just at
  login), so deactivating mid-session blocks the very next request.
- `proxy.ts` (not `middleware.ts` — see the note at the top of that
  file) checks the Supabase session via `@supabase/ssr` on every
  `/admin/*` and `/api/admin/*` request, using `auth.getUser()` (not
  `getSession()`) so the JWT is revalidated against the Auth server
  rather than trusted from a decoded cookie.
- **Staff role is a strict allowlist**, not a blocklist: staff may
  only reach `/admin/pos`, `/admin/production`, `/admin/calendar`,
  `/admin/inventory` (pages and their `/api/admin/*` equivalents),
  plus the shared low-stock alerts endpoint. Everything else under
  `/admin/*` — including the dashboard root `/admin` itself — redirects
  staff to `/admin/pos?denied=1`. Any new admin page is staff-blocked
  by default unless explicitly added to `STAFF_ALLOWED_PREFIXES` /
  `STAFF_ALLOWED_API_PREFIXES` in `proxy.ts`.
- `lib/supabaseBrowser.ts` (cookie-backed session, admin-side only) vs
  `lib/supabase.ts` (unchanged, localStorage-backed, customer site
  only) vs `lib/supabaseServer.ts` (Route Handlers / Server Components
  needing the current user) vs `lib/supabaseAdmin.ts` (service-role,
  bypasses RLS entirely) — four different Supabase clients for four
  different trust levels; don't mix them up.
- `/admin/settings/staff` (admin-only) creates staff via the Auth
  Admin API (`supabaseAdmin.auth.admin.createUser()`, `email_confirm: true`)
  then inserts the matching `staff_users` row — these are two separate
  systems (GoTrue + Postgres) that can't share one transaction, so a
  failed `staff_users` insert triggers a best-effort compensating
  `deleteUser()` on the just-created Auth account.

**Manual dashboard steps this depended on** (can't be done from code):
1. Supabase dashboard → Authentication → Providers → Email must be
   enabled.
2. Supabase dashboard → Authentication → Sessions — the spec asked
   for 8-hour sessions; the closest equivalent is the dashboard's
   session time-box setting (if available on your plan) or JWT expiry
   under Authentication → Settings. Neither is configurable from a
   migration or app code.
3. The very first admin account: create the Auth user (Authentication
   → Users → Add user) and a matching `staff_users` row with
   `role = 'admin'` — `/admin/settings/staff` can create every
   subsequent staff member, but it's admin-only, so the first admin
   has to exist before anyone can use it.
