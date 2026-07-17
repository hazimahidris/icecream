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

### Phase 4 — next
Reporting, discounts engine, proper auth, final testing and go-live.

## Admin auth
Note in CLAUDE.md: /admin/* is currently protected by a single
shared password gate (ADMIN_PASSWORD env var, checked server-side).
This is temporary. Phase 4 will replace this with proper auth:
Supabase Auth with role-based access (admin / staff), separate login
per user, and an audit log on the payment_receipts table.
