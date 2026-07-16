import "server-only";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const resend = new Resend(process.env.RESEND_API_KEY);

const BUSINESS_NAME = process.env.NEXT_PUBLIC_BUSINESS_NAME ?? "";
const BUSINESS_PHONE = process.env.NEXT_PUBLIC_BUSINESS_PHONE ?? "";
const BUSINESS_WHATSAPP = process.env.NEXT_PUBLIC_BUSINESS_WHATSAPP ?? "";
const BUSINESS_ADDRESS = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS ?? "";
const BUSINESS_HOURS = process.env.NEXT_PUBLIC_BUSINESS_HOURS ?? "";

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatShortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]}`;
}

function formatTimeLabel(time: string) {
  let h = Number(time.split(":")[0]);
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:00 ${period}`;
}

function formatOrderCode(orderNumber: number) {
  return `ORD-${String(orderNumber).padStart(4, "0")}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildEmailHtml(params: {
  customerName: string;
  orderCode: string;
  flavours: { name: string; qty: number }[];
  addons: { name: string; qty: number }[];
  fulfilmentType: string;
  fulfilmentDateLabel: string;
  fulfilmentTimeLabel: string;
  balanceDue: number;
}) {
  const {
    customerName,
    orderCode,
    flavours,
    addons,
    fulfilmentType,
    fulfilmentDateLabel,
    fulfilmentTimeLabel,
    balanceDue,
  } = params;

  const fulfilmentLabel = fulfilmentType === "delivery" ? "Delivery" : "Pickup";

  const flavourList = flavours
    .map((f) => `<li>${escapeHtml(f.name)} x${f.qty}</li>`)
    .join("");

  const addonSection = addons.length
    ? `<p><strong>Add-ons:</strong></p><ul>${addons
        .map((a) => `<li>${escapeHtml(a.name)} x${a.qty}</li>`)
        .join("")}</ul>`
    : "";

  const balanceLine =
    balanceDue > 0
      ? `<p><strong>Balance due at ${fulfilmentLabel.toLowerCase()}:</strong> RM ${balanceDue.toFixed(2)}</p>`
      : "";

  const fulfilmentNote =
    fulfilmentType === "delivery"
      ? `<p>Our driver will contact you before arriving. Please ensure someone is available at the delivery address.</p>`
      : `<p>Please bring your Order ID <strong>${orderCode}</strong> when collecting.</p>`;

  const whatsappDigits = BUSINESS_WHATSAPP.replace(/\D/g, "");

  const footer = `
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 13px; color: #555;">
      ${BUSINESS_NAME ? `<p style="margin: 0 0 4px; font-weight: bold;">${escapeHtml(BUSINESS_NAME)}</p>` : ""}
      ${BUSINESS_ADDRESS ? `<p style="margin: 0 0 4px;">${escapeHtml(BUSINESS_ADDRESS)}</p>` : ""}
      ${BUSINESS_PHONE ? `<p style="margin: 0 0 4px;">Phone: ${escapeHtml(BUSINESS_PHONE)}</p>` : ""}
      ${whatsappDigits ? `<p style="margin: 0 0 4px;"><a href="https://wa.me/${whatsappDigits}">WhatsApp us</a></p>` : ""}
      ${BUSINESS_HOURS ? `<p style="margin: 0;">Hours: ${escapeHtml(BUSINESS_HOURS)}</p>` : ""}
    </div>
  `;

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h2 style="margin-bottom: 4px;">Booking Confirmed</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Your payment has been verified and your booking is confirmed!</p>

      <p><strong>Order ${orderCode}</strong></p>
      <p><strong>Flavours:</strong></p>
      <ul>${flavourList}</ul>
      ${addonSection}

      <p><strong>${fulfilmentLabel} date:</strong> ${fulfilmentDateLabel}</p>
      <p><strong>Time:</strong> ${fulfilmentTimeLabel}</p>
      <p><strong>Fulfilment type:</strong> ${fulfilmentLabel}</p>

      ${balanceLine}
      ${fulfilmentNote}
      ${footer}
    </div>
  `;
}

// Best-effort — never throws. A failure here (no email on file, Resend
// error, etc.) must never fail the payment approval that triggered it,
// since the DB update has already succeeded by the time this runs.
export async function sendBookingConfirmationEmail(orderId: string) {
  try {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select(
        `order_number, fulfilment_type, fulfilment_date, fulfilment_time,
         total, deposit_paid, customers ( name, email )`
      )
      .eq("id", orderId)
      .single();

    const customer = Array.isArray(order?.customers)
      ? order?.customers[0]
      : order?.customers;

    if (!order || !customer?.email) {
      return; // no email on file — skip silently
    }

    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("qty, products ( name ), addons ( name )")
      .eq("order_id", orderId);

    const flavours = (items ?? [])
      .filter((item) => item.products)
      .map((item) => {
        const product = Array.isArray(item.products)
          ? item.products[0]
          : item.products;
        return { name: product?.name ?? "Item", qty: item.qty };
      });

    const addonItems = (items ?? [])
      .filter((item) => item.addons)
      .map((item) => {
        const addon = Array.isArray(item.addons) ? item.addons[0] : item.addons;
        return { name: addon?.name ?? "Add-on", qty: item.qty };
      });

    const balanceDue = order.total - order.deposit_paid;
    const orderCode = formatOrderCode(order.order_number);

    const html = buildEmailHtml({
      customerName: customer.name ?? "there",
      orderCode,
      flavours,
      addons: addonItems,
      fulfilmentType: order.fulfilment_type,
      fulfilmentDateLabel: formatShortDate(order.fulfilment_date),
      fulfilmentTimeLabel: formatTimeLabel(order.fulfilment_time),
      balanceDue,
    });

    const { error: sendError } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: customer.email,
      subject: `Booking Confirmed — ${orderCode} | Chillpop`,
      html,
    });

    // resend.emails.send() resolves with { error } on API-level failures
    // (bad EMAIL_FROM domain, expired key, rate limit) — it does not
    // throw for those, so this check is required, not just the catch
    // block below (which only covers thrown exceptions, e.g. network
    // failures).
    if (sendError) {
      console.error("BOOKING EMAIL FAILED — order:", orderId, sendError);
    }
  } catch (err) {
    console.error("BOOKING EMAIL FAILED — order:", orderId, err);
  }
}
