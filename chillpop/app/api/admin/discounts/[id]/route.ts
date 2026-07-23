import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VALID_TYPES = ["percent", "flat", "bulk_qty"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const rawCode = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const code = rawCode || null;
  const type = typeof body?.type === "string" ? body.type : "";
  const value = Number(body?.value ?? NaN);
  const minQty =
    body?.minQty === null || body?.minQty === undefined || body?.minQty === ""
      ? null
      : Number(body.minQty);
  const validFrom = typeof body?.validFrom === "string" && body.validFrom ? body.validFrom : null;
  const validTo = typeof body?.validTo === "string" && body.validTo ? body.validTo : null;
  const isActive = body?.isActive !== false;

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Select a valid discount type." }, { status: 400 });
  }
  if (Number.isNaN(value) || value <= 0) {
    return NextResponse.json({ error: "Enter a valid value." }, { status: 400 });
  }
  if (type === "bulk_qty") {
    if (minQty === null || Number.isNaN(minQty) || minQty <= 0) {
      return NextResponse.json(
        { error: "Enter a valid minimum qty for a bulk discount." },
        { status: 400 }
      );
    }
  }
  if (validFrom && validTo && validFrom > validTo) {
    return NextResponse.json({ error: "Valid from must be before valid to." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("discounts")
    .update({
      code,
      type,
      value,
      min_qty: type === "bulk_qty" ? minQty : null,
      valid_from: validFrom,
      valid_to: validTo,
      is_active: isActive,
      updated_at: new Date().toISOString(),
      updated_by: "admin",
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This code is already in use." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
