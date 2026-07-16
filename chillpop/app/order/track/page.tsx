"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// The 9-stage happy-path workflow from the SRS. cancelled /
// payment_rejected / payment_expired are exception states that fall
// outside this linear progression and are shown separately.
const STAGES = [
  "draft",
  "awaiting_payment",
  "payment_submitted",
  "payment_verified",
  "booking_confirmed",
  "preparing",
  "ready",
  "delivered",
  "completed",
] as const;

const EXCEPTION_STATUSES = ["cancelled", "payment_rejected", "payment_expired"];

const VERIFIED_ONWARDS = [
  "payment_verified",
  "booking_confirmed",
  "preparing",
  "ready",
  "delivered",
  "completed",
];

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

function formatStatus(status: string) {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatOrderCode(orderNumber: number) {
  return `ORD-${String(orderNumber).padStart(4, "0")}`;
}

function getPaymentStatus(status: string): string | null {
  if (status === "awaiting_payment") return "Pending";
  if (status === "payment_submitted") return "Submitted";
  if (status === "payment_rejected") return "Rejected";
  if (VERIFIED_ONWARDS.includes(status)) return "Verified";
  return null;
}

type TrackedOrderItem = { name: string; qty: number };

type TrackedOrder = {
  id: string;
  order_number: number;
  status: string;
  fulfilment_date: string;
  total: number;
  rejection_reason: string | null;
  items: TrackedOrderItem[];
};

export default function TrackOrderPage() {
  const [orderIdInput, setOrderIdInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit() {
    setFormError(null);

    const orderNumber = parseInt(orderIdInput.replace(/\D/g, ""), 10);
    if (Number.isNaN(orderNumber)) {
      setFormError("Please enter a valid Order ID, e.g. ORD-0001.");
      return;
    }
    if (!phoneInput.trim()) {
      setFormError("Please enter your mobile number.");
      return;
    }

    setLoading(true);
    setSearched(false);
    setOrder(null);

    const { data, error } = await supabase.rpc("track_order", {
      p_order_number: orderNumber,
      p_phone: phoneInput.trim(),
    });

    if (error) {
      setFormError(error.message);
    } else {
      setOrder((data?.[0] as TrackedOrder) ?? null);
    }

    setSearched(true);
    setLoading(false);
  }

  const isException = order ? EXCEPTION_STATUSES.includes(order.status) : false;
  const stageIndex = order
    ? STAGES.indexOf(order.status as (typeof STAGES)[number])
    : -1;
  const paymentStatus = order ? getPaymentStatus(order.status) : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-gray-900 sm:px-6 dark:text-gray-100">
      <Link href="/order" className="text-sm text-gray-500 underline">
        Back to menu
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Track Your Order</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="mt-6 space-y-4"
      >
        <div>
          <label className="text-sm font-medium" htmlFor="track-order-id">
            Order ID
          </label>
          <input
            id="track-order-id"
            type="text"
            value={orderIdInput}
            onChange={(e) => setOrderIdInput(e.target.value)}
            placeholder="ORD-0001"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="track-phone">
            Mobile number
          </label>
          <input
            id="track-phone"
            type="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="012-3456789"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
          />
        </div>

        {formError && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
        >
          {loading ? "Searching..." : "Track Order"}
        </button>
      </form>

      {searched && !order && (
        <p className="mt-6 rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          Order not found. Please check your Order ID and mobile number.
        </p>
      )}

      {order && (
        <div className="mt-8 space-y-6">
          <div>
            <h2 className="text-sm font-medium">
              {formatOrderCode(order.order_number)}
            </h2>

            {isException ? (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                Status: {formatStatus(order.status)}
              </p>
            ) : (
              <>
                <div className="mt-4 flex items-center">
                  {STAGES.map((stage, i) => (
                    <div
                      key={stage}
                      className="flex flex-1 items-center last:flex-none"
                    >
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                          i <= stageIndex
                            ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                            : "bg-gray-200 text-gray-500 dark:bg-gray-700"
                        }`}
                      >
                        {i + 1}
                      </div>
                      {i < STAGES.length - 1 && (
                        <div
                          className={`h-0.5 flex-1 ${
                            i < stageIndex
                              ? "bg-gray-900 dark:bg-gray-100"
                              : "bg-gray-200 dark:bg-gray-700"
                          }`}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {formatStatus(order.status)}
                </p>
              </>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h3 className="text-sm font-medium">Order Summary</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {order.items.map((item, i) => (
                <li key={i}>
                  {item.name} x{item.qty}
                </li>
              ))}
            </ul>
            <div className="mt-2 space-y-1 border-t border-gray-200 pt-2 text-sm dark:border-gray-700">
              <p>
                <span className="text-gray-500">Fulfilment date: </span>
                {formatShortDate(order.fulfilment_date)}
              </p>
              <p className="font-medium">Total: RM {order.total.toFixed(2)}</p>
            </div>
          </div>

          {paymentStatus && (
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <h3 className="text-sm font-medium">Payment Status</h3>
              <p className="mt-1 text-sm">{paymentStatus}</p>
              {order.status === "payment_rejected" &&
                order.rejection_reason && (
                  <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                    Reason: {order.rejection_reason}
                  </p>
                )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
