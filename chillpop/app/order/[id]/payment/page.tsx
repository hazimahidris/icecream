"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type OrderPayment = {
  id: string;
  order_number: number;
  customer_name: string | null;
  status: string;
  fulfilment_type: "pickup" | "delivery";
  fulfilment_date: string;
  fulfilment_time: string;
  total: number;
  deposit_required: number;
};

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

function formatStatus(status: string) {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatOrderCode(orderNumber: number) {
  return `ORD-${String(orderNumber).padStart(4, "0")}`;
}

const BANK_NAME = process.env.NEXT_PUBLIC_BANK_NAME ?? "";
const ACCOUNT_NAME = process.env.NEXT_PUBLIC_ACCOUNT_NAME ?? "";
const ACCOUNT_NUMBER = process.env.NEXT_PUBLIC_ACCOUNT_NUMBER ?? "";

const ACCEPTED_FILE_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
// Placeholder SLA — the spec left this as "[X hours]"; adjust to your actual turnaround.
const VERIFICATION_HOURS = 24;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) — the
      // button just silently stays as "Copy" if it fails.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 flex min-h-11 min-w-11 items-center justify-center rounded border border-gray-300 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function OrderPaymentPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [order, setOrder] = useState<OrderPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const uploadRef = useRef<HTMLDivElement>(null);

  const [bankName, setBankName] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [transferDatetime, setTransferDatetime] = useState("");
  const [amountTransferred, setAmountTransferred] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptFormError, setReceiptFormError] = useState<string | null>(
    null
  );
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [receiptSubmitted, setReceiptSubmitted] = useState(false);

  useEffect(() => {
    async function loadOrder() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase.rpc("get_order_for_payment", {
        p_order_id: orderId,
      });

      if (error) {
        setError(error.message);
      } else {
        setOrder((data?.[0] as OrderPayment) ?? null);
      }

      setLoading(false);
    }

    loadOrder();
  }, [orderId]);

  function handleUploadClick() {
    setShowUpload(true);
    requestAnimationFrame(() => {
      uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function handleSubmitReceipt() {
    setReceiptFormError(null);

    if (!receiptFile) {
      setReceiptFormError("Please attach a receipt file.");
      return;
    }
    if (!ACCEPTED_FILE_TYPES.includes(receiptFile.type)) {
      setReceiptFormError("Receipt must be a JPG, PNG, or PDF file.");
      return;
    }
    if (receiptFile.size > MAX_FILE_SIZE) {
      setReceiptFormError("Receipt file must be 5MB or smaller.");
      return;
    }

    const amount = Number(amountTransferred);
    if (!amountTransferred || Number.isNaN(amount) || amount <= 0) {
      setReceiptFormError("Please enter the amount you transferred.");
      return;
    }

    setSubmittingReceipt(true);

    const ext = receiptFile.name.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `${orderId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(path, receiptFile);

    if (uploadError) {
      setReceiptFormError(uploadError.message);
      setSubmittingReceipt(false);
      return;
    }

    const { error: receiptError } = await supabase.rpc(
      "submit_payment_receipt",
      {
        p_order_id: orderId,
        p_amount_claimed: amount,
        p_bank_name: bankName.trim() || null,
        p_transfer_reference: transferReference.trim() || null,
        p_transfer_datetime: transferDatetime || null,
        p_receipt_url: path,
        p_file_type: ext,
      }
    );

    if (receiptError) {
      setReceiptFormError(receiptError.message);
      setSubmittingReceipt(false);
      return;
    }

    setOrder((prev) =>
      prev ? { ...prev, status: "payment_submitted" } : prev
    );
    setReceiptSubmitted(true);
    setSubmittingReceipt(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-sm text-gray-500">
        Loading...
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Error loading order: {error}
        </p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-gray-500">Order not found.</p>
        <Link href="/order" className="mt-2 inline-block text-sm underline">
          Back to menu
        </Link>
      </main>
    );
  }

  const orderCode = formatOrderCode(order.order_number);
  const balanceDue = order.total - order.deposit_required;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-gray-900 sm:px-6 dark:text-gray-100">
      {/* 1. Order confirmed banner */}
      <div className="rounded-lg border border-green-300 bg-green-50 p-6 text-center dark:border-green-800 dark:bg-green-950">
        <p className="text-lg font-medium">
          Thank you{order.customer_name ? `, ${order.customer_name}` : ""}!
          Your order has been received.
        </p>
        <p className="mt-3 flex items-center justify-center text-2xl font-bold tracking-wide">
          {orderCode}
          <CopyButton value={orderCode} />
        </p>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Status: {formatStatus(order.status)}
        </p>
      </div>

      {/* 2. What to pay */}
      <div className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">What to Pay</h2>
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Amount due now</span>
            <span className="font-medium">
              RM {order.deposit_required.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Balance due at {order.fulfilment_type}</span>
            <span>RM {balanceDue.toFixed(2)}</span>
          </div>
        </div>
        <div className="mt-4 space-y-1 border-t border-gray-200 pt-3 text-sm dark:border-gray-700">
          <p>
            <span className="text-gray-500">Fulfilment date: </span>
            {formatShortDate(order.fulfilment_date)}
          </p>
          <p>
            <span className="text-gray-500">Fulfilment time: </span>
            {formatTimeLabel(order.fulfilment_time)}
          </p>
        </div>
      </div>

      {/* 3. Payment instructions */}
      <div className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Payment Instructions</h2>
        <div className="mt-3 space-y-1 text-sm">
          <p>
            <span className="text-gray-500">Bank name: </span>
            {BANK_NAME}
          </p>
          <p>
            <span className="text-gray-500">Account name: </span>
            {ACCOUNT_NAME}
          </p>
          <p className="flex items-center">
            <span className="text-gray-500">Account number: </span>
            {ACCOUNT_NUMBER}
            <CopyButton value={ACCOUNT_NUMBER} />
          </p>
        </div>

        <div className="mt-4 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/duitnow-qr.jpeg"
            alt="DuitNow QR code"
            className="w-48 rounded-lg border border-gray-200 dark:border-gray-700"
          />
          <a
            href="/duitnow-qr.jpeg"
            download="duitnow-qr.jpeg"
            className="mt-2 flex min-h-11 items-center justify-center px-3 text-xs text-gray-500 underline"
          >
            Download QR code
          </a>
        </div>

        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Important: Please include your Order ID <strong>{orderCode}</strong>{" "}
          in the transfer reference.
        </p>
      </div>

      {/* 4. Upload receipt */}
      <button
        type="button"
        onClick={handleUploadClick}
        className="mt-6 w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      >
        I have transferred — Upload Receipt
      </button>

      {showUpload && (
        <div
          ref={uploadRef}
          className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
        >
          {receiptSubmitted ? (
            <p className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              Receipt submitted! We will verify your payment within{" "}
              {VERIFICATION_HOURS} hours and confirm your booking.
            </p>
          ) : (
            <>
              <h2 className="text-sm font-medium">Upload Receipt</h2>

              <div className="mt-3">
                <label className="text-sm font-medium" htmlFor="bank-name">
                  Bank name (optional)
                </label>
                <input
                  id="bank-name"
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. Maybank, CIMB, RHB"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div className="mt-3">
                <label
                  className="text-sm font-medium"
                  htmlFor="transfer-reference"
                >
                  Transfer reference number (optional)
                </label>
                <input
                  id="transfer-reference"
                  type="text"
                  value={transferReference}
                  onChange={(e) => setTransferReference(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div className="mt-3">
                <label
                  className="text-sm font-medium"
                  htmlFor="transfer-datetime"
                >
                  Transfer date and time (optional)
                </label>
                <input
                  id="transfer-datetime"
                  type="datetime-local"
                  value={transferDatetime}
                  onChange={(e) => setTransferDatetime(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div className="mt-3">
                <label
                  className="text-sm font-medium"
                  htmlFor="amount-transferred"
                >
                  Amount transferred
                </label>
                <input
                  id="amount-transferred"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={amountTransferred}
                  onChange={(e) => setAmountTransferred(e.target.value)}
                  placeholder="RM"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div className="mt-3">
                <label className="text-sm font-medium" htmlFor="receipt-file">
                  Receipt file (JPG, PNG, or PDF — max 5MB)
                </label>
                <input
                  id="receipt-file"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(e) =>
                    setReceiptFile(e.target.files?.[0] ?? null)
                  }
                  className="mt-1 block w-full text-sm"
                />
              </div>

              {receiptFormError && (
                <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {receiptFormError}
                </p>
              )}

              <button
                type="button"
                onClick={handleSubmitReceipt}
                disabled={submittingReceipt}
                className="mt-4 w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {submittingReceipt ? "Submitting..." : "Submit Receipt"}
              </button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
