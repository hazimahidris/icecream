import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const today = todayISO();

  const { data: schedules, error: schedulesError } = await supabaseAdmin
    .from("production_schedules")
    .select(
      "id, scheduled_date, qty_planned, start_time, complete_by, packaging_time, status, notes, products ( id, name )"
    )
    .gte("scheduled_date", today)
    .order("scheduled_date")
    .order("start_time");

  if (schedulesError) {
    return NextResponse.json({ error: schedulesError.message }, { status: 500 });
  }

  const { data: capacityConfig, error: capacityError } = await supabaseAdmin
    .from("production_capacity_config")
    .select("id, day_of_week, specific_date, max_qty, notes")
    .order("day_of_week");

  if (capacityError) {
    return NextResponse.json({ error: capacityError.message }, { status: 500 });
  }

  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  return NextResponse.json({
    schedules: (schedules ?? []).map((s) => {
      const product = Array.isArray(s.products) ? s.products[0] : s.products;
      return {
        id: s.id,
        productId: product?.id ?? null,
        productName: product?.name ?? "Item",
        scheduledDate: s.scheduled_date,
        qtyPlanned: s.qty_planned,
        startTime: s.start_time,
        completeBy: s.complete_by,
        packagingTime: s.packaging_time,
        status: s.status,
        notes: s.notes,
      };
    }),
    capacityConfig: capacityConfig ?? [],
    products: products ?? [],
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const productId = typeof body?.productId === "string" ? body.productId : "";
  const scheduledDate = typeof body?.scheduledDate === "string" ? body.scheduledDate : "";
  const qtyPlanned = Number(body?.qtyPlanned ?? NaN);
  const startTime = typeof body?.startTime === "string" ? body.startTime : "";
  const completeBy = typeof body?.completeBy === "string" ? body.completeBy : "";
  const packagingTime = typeof body?.packagingTime === "string" ? body.packagingTime : "";
  const notes = typeof body?.notes === "string" ? body.notes : "";

  if (!productId || !scheduledDate) {
    return NextResponse.json(
      { error: "Flavour and date are required." },
      { status: 400 }
    );
  }
  if (Number.isNaN(qtyPlanned) || qtyPlanned <= 0) {
    return NextResponse.json({ error: "Enter a valid quantity." }, { status: 400 });
  }
  if (scheduledDate < todayISO()) {
    return NextResponse.json(
      { error: "Date must be today or in the future." },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.from("production_schedules").insert({
    product_id: productId,
    scheduled_date: scheduledDate,
    qty_planned: qtyPlanned,
    start_time: startTime || null,
    complete_by: completeBy || null,
    packaging_time: packagingTime || null,
    notes: notes || null,
    status: "queued",
    created_by: "admin",
    updated_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
