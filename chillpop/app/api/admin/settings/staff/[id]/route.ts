import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VALID_ROLES = ["admin", "staff"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const update: Record<string, unknown> = {};

  if ("role" in (body ?? {})) {
    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "Select a valid role." }, { status: 400 });
    }
    update.role = body.role;
  }

  if ("isActive" in (body ?? {})) {
    update.is_active = body.isActive !== false;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin.from("staff_users").update(update).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
