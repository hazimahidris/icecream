"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { paymentMethodLabel } from "@/lib/paymentMethod";

type ReceiptItem = { name: string; qty: number; unitPrice: number };

type ReceiptData = {
  orderNumber: number;
  createdAt: string;
  subtotal: number;
  discountAmount: number;
  discountCode: string | null;
  total: number;
  paymentMethod: string;
  flavours: ReceiptItem[];
  addons: ReceiptItem[];
};

const BUSINESS_NAME = process.env.NEXT_PUBLIC_BUSINESS_NAME ?? "";
const BUSINESS_ADDRESS = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS ?? "";

function formatOrderCode(orderNumber: number) {
  return `ORD-${String(orderNumber).padStart(4, "0")}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function PosReceiptPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;

  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReceipt() {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/admin/pos/receipt/${orderId}`);

      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Could not load receipt.");
      } else {
        setReceipt(json);
      }

      setLoading(false);
    }

    loadReceipt();
  }, [orderId, router]);

  if (loading) {
    return (
      <main className="mx-auto max-w-[80mm] px-4 py-10 text-sm text-gray-500">
        Loading...
      </main>
    );
  }

  if (error || !receipt) {
    return (
      <main className="mx-auto max-w-[80mm] px-4 py-10">
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error ?? "Receipt not found."}
        </p>
        <Link href="/admin/pos" className="mt-4 inline-block text-sm underline">
          Back to POS
        </Link>
      </main>
    );
  }

  const orderCode = formatOrderCode(receipt.orderNumber);

  return (
    <>
      {/* @page controls the printed page size for an 80mm thermal
          printer — not expressible as a Tailwind utility class. */}
      <style>{`
        @page { size: 80mm auto; margin: 4mm; }
      `}</style>

      <main className="mx-auto max-w-[80mm] px-4 py-10 font-mono text-gray-900 dark:text-gray-100">
        <div className="text-center">
          {BUSINESS_NAME && <p className="text-sm font-bold">{BUSINESS_NAME}</p>}
          {BUSINESS_ADDRESS && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {BUSINESS_ADDRESS}
            </p>
          )}
        </div>

        <div className="mt-4 space-y-0.5 border-t border-dashed border-gray-400 pt-3 text-xs">
          <div className="flex justify-between gap-2">
            <span>Order</span>
            <span className="shrink-0">{orderCode}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Date</span>
            <span className="shrink-0">{formatDateTime(receipt.createdAt)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Cashier</span>
            <span className="shrink-0">Admin</span>
          </div>
        </div>

        <div className="mt-3 space-y-1 border-t border-dashed border-gray-400 pt-3 text-xs">
          {receipt.flavours.map((item, i) => (
            <div key={i}>
              <div className="flex justify-between gap-2">
                <span className="min-w-0 break-words">{item.name}</span>
                <span className="shrink-0">
                  RM {(item.unitPrice * item.qty).toFixed(2)}
                </span>
              </div>
              <p className="text-gray-500">
                {item.qty} x RM {item.unitPrice.toFixed(2)}
              </p>
            </div>
          ))}

          {receipt.addons.length > 0 && (
            <>
              <p className="pt-1 text-gray-500">Add-ons</p>
              {receipt.addons.map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 break-words">{item.name}</span>
                    <span className="shrink-0">
                      RM {(item.unitPrice * item.qty).toFixed(2)}
                    </span>
                  </div>
                  <p className="text-gray-500">
                    {item.qty} x RM {item.unitPrice.toFixed(2)}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="mt-3 space-y-1 border-t border-dashed border-gray-400 pt-3 text-xs">
          <div className="flex justify-between gap-2">
            <span>Subtotal</span>
            <span className="shrink-0">RM {receipt.subtotal.toFixed(2)}</span>
          </div>
          {receipt.discountAmount > 0 && (
            <div className="flex justify-between gap-2">
              <span className="min-w-0 break-words">
                Discount{receipt.discountCode ? ` (${receipt.discountCode})` : ""}
              </span>
              <span className="shrink-0">
                -RM {receipt.discountAmount.toFixed(2)}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2 text-sm font-bold">
            <span>Total</span>
            <span className="shrink-0">RM {receipt.total.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Payment</span>
            <span className="shrink-0">
              {paymentMethodLabel(receipt.paymentMethod)}
            </span>
          </div>
        </div>

        <p className="mt-4 border-t border-dashed border-gray-400 pt-3 text-center text-xs">
          Terima kasih! Thank you for your purchase.
        </p>

        <div className="print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="mt-6 min-h-11 w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
          >
            Print
          </button>
          <Link
            href="/admin/pos"
            className="mt-2 flex min-h-11 w-full items-center justify-center rounded border border-gray-300 px-4 py-3 text-sm font-medium dark:border-gray-700"
          >
            New Sale
          </Link>
        </div>
      </main>
    </>
  );
}
