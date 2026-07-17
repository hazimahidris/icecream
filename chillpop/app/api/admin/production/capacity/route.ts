import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// "Add date override" — a one-off max_qty for a specific date, taking
// priority over that date's day_of_week default (see the one_target
// CHECK constraint on production_capacity_config: exactly one of
// day_of_week / specific_date must be set, never both).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const specificDate = typeof body?.specificDate === "string" ? body.specificDate : "";
  const maxQty = Number(body?.maxQty ?? NaN);
  const notes = typeof body?.notes === "string" ? body.notes : "";

  if (!specificDate) {
    return NextResponse.json({ error: "Date is required." }, { status: 400 });
  }
  if (specificDate < todayISO()) {
    return NextResponse.json(
      { error: "Date must be today or in the future." },
      { status: 400 }
    );
  }
  if (Number.isNaN(maxQty) || maxQty <= 0) {
    return NextResponse.json({ error: "Enter a valid max quantity." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("production_capacity_config").insert({
    day_of_week: null,
    specific_date: specificDate,
    max_qty: maxQty,
    notes: notes || null,
    created_by: "admin",
    updated_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
