import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Enter a name." }, { status: 400 });
    }
    update.name = name;
  }

  if ("categoryId" in body) {
    update.category_id = typeof body.categoryId === "string" && body.categoryId ? body.categoryId : null;
  }

  if ("sellingPrice" in body) {
    const sellingPrice = Number(body.sellingPrice);
    if (Number.isNaN(sellingPrice) || sellingPrice <= 0) {
      return NextResponse.json({ error: "Enter a valid selling price." }, { status: 400 });
    }
    update.selling_price = sellingPrice;
  }

  if ("imageUrl" in body) {
    update.image_url =
      typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  }

  if ("maxDailyQty" in body) {
    const raw = body.maxDailyQty;
    if (raw === null || raw === "") {
      update.max_daily_qty = null;
    } else {
      const maxDailyQty = Number(raw);
      if (Number.isNaN(maxDailyQty) || maxDailyQty < 0) {
        return NextResponse.json({ error: "Enter a valid max daily qty." }, { status: 400 });
      }
      update.max_daily_qty = maxDailyQty;
    }
  }

  if ("isActive" in body) {
    update.is_active = body.isActive !== false;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();
  update.updated_by = "admin";

  const { error } = await supabaseAdmin.from("products").update(update).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
