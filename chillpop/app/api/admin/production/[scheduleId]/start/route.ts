import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scheduleId: string }> }
) {
  const { scheduleId } = await params;

  const { data: schedule } = await supabaseAdmin
    .from("production_schedules")
    .select("status")
    .eq("id", scheduleId)
    .single();

  if (!schedule || schedule.status !== "queued") {
    return NextResponse.json(
      { error: "Schedule is not queued." },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from("production_schedules")
    .update({ status: "in_production", updated_by: "admin" })
    .eq("id", scheduleId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
