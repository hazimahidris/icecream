import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VALID_REASONS = ["restock", "stock_take", "wastage", "other"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const newQty = Number(body?.newQty ?? NaN);
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if (Number.isNaN(newQty) || newQty < 0) {
    return NextResponse.json({ error: "Enter a valid quantity." }, { status: 400 });
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: "Select a valid reason." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("adjust_ingredient_stock", {
    p_ingredient_id: id,
    p_new_qty: newQty,
    p_reason: reason,
    p_notes: notes || null,
    p_created_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, adjustmentId: data });
}
