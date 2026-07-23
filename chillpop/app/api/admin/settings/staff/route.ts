import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VALID_ROLES = ["admin", "staff"];

export async function GET() {
  const { data: staff, error } = await supabaseAdmin
    .from("staff_users")
    .select("id, name, role, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // auth.users isn't exposed through PostgREST — look emails up
  // individually via the Auth Admin API instead.
  const result = await Promise.all(
    (staff ?? []).map(async (s) => {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(s.id);
      return {
        id: s.id,
        name: s.name,
        email: authUser?.user?.email ?? null,
        role: s.role,
        isActive: s.is_active,
        createdAt: s.created_at,
      };
    })
  );

  return NextResponse.json({ staff: result });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = typeof body?.role === "string" ? body.role : "";

  if (!name) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "Enter an email." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Select a valid role." }, { status: 400 });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Could not create the account." },
      { status: 400 }
    );
  }

  const { error: staffError } = await supabaseAdmin.from("staff_users").insert({
    id: created.user.id,
    name,
    role,
    is_active: true,
  });

  if (staffError) {
    // Best-effort cleanup — the Auth Admin API and Postgres are two
    // separate systems, so this can't be a single transaction.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: staffError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}
