import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BOARD_STATUSES = ["booking_confirmed", "preparing", "ready", "delivered", "completed"];

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      `id, order_number, channel, fulfilment_type, fulfilment_date, status,
       total, deposit_paid,
       customers ( name, phone )`
    )
    .in("status", BOARD_STATUSES)
    .order("fulfilment_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orders = (data ?? []).map((o) => {
    const customer = Array.isArray(o.customers) ? o.customers[0] : o.customers;
    return {
      id: o.id,
      orderNumber: o.order_number,
      channel: o.channel,
      fulfilmentType: o.fulfilment_type,
      fulfilmentDate: o.fulfilment_date,
      status: o.status,
      total: Number(o.total),
      depositPaid: Number(o.deposit_paid),
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
    };
  });

  return NextResponse.json({ orders });
}
