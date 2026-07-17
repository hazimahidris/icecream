import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const returnQty = Number(body?.returnQty ?? NaN);
  if (!Number.isInteger(returnQty) || returnQty <= 0) {
    return NextResponse.json(
      { error: "Enter a valid whole number quantity." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin.rpc("mark_foam_box_returned", {
    p_rental_id: id,
    p_return_qty: returnQty,
    p_created_by: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rentalId: data });
}
