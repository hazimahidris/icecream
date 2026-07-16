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
- `/admin/login` — admin password login

Integrations:
- Resend sends the booking confirmation email on payment approval (`RESEND_API_KEY`, `EMAIL_FROM` in `.env.local`) — see `lib/sendBookingConfirmation.ts`
- DuitNow QR code is a static asset at `public/duitnow-qr.jpeg`

### Phase 3 — next
POS, production planning, booking calendar.

## Admin auth
Note in CLAUDE.md: /admin/* is currently protected by a single
shared password gate (ADMIN_PASSWORD env var, checked server-side).
This is temporary. Phase 4 will replace this with proper auth:
Supabase Auth with role-based access (admin / staff), separate login
per user, and an audit log on the payment_receipts table.
