import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const maxQty = Number(body?.maxQty ?? NaN);

  if (Number.isNaN(maxQty) || maxQty <= 0) {
    return NextResponse.json({ error: "Enter a valid max quantity." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("production_capacity_config")
    .update({ max_qty: maxQty, updated_by: "admin" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
