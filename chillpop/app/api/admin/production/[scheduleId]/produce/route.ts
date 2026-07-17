import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const { scheduleId } = await params;
  const body = await request.json().catch(() => null);
  const qtyProduced = Number(body?.qtyProduced ?? NaN);

  if (Number.isNaN(qtyProduced) || qtyProduced <= 0) {
    return NextResponse.json({ error: "Invalid quantity." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("mark_production_produced", {
    p_schedule_id: scheduleId,
    p_qty_produced: qtyProduced,
    p_created_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, productionLogId: data });
}
