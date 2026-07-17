"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AdminLogout } from "@/components/AdminLogout";

type OrderRow = {
  id: string;
  orderNumber: number | null;
  channel: string;
  fulfilmentType: string;
  fulfilmentDate: string;
  status: string;
  total: number;
  depositPaid: number;
  customerName: string | null;
  customerPhone: string | null;
};

const COLUMNS: { key: string; label: string }[] = [
  { key: "booking_confirmed", label: "Booking Confirmed" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "delivered", label: "Delivered" },
  { key: "completed", label: "Completed" },
];

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

function formatMoney(n: number) {
  return `RM ${n.toFixed(2)}`;
}

export default function OrdersPage() {
  const router = useRouter();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [cancelModal, setCancelModal] = useState<OrderRow | null>(null);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function loadOrders() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/orders");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load orders.");
    } else {
      setOrders(json.orders ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(orderId: string, endpoint: string, successMessage: string) {
    setActionError(null);
    setActionMessage(null);
    setBusyOrderId(orderId);

    const res = await fetch(`/api/admin/orders/${orderId}/${endpoint}`, { method: "POST" });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setBusyOrderId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Action failed.");
      return;
    }

    setActionMessage(successMessage);
    loadOrders();
  }

  function openCancelModal(row: OrderRow) {
    setCancelModal(row);
    setCancelError(null);
  }

  async function handleConfirmCancel() {
    if (!cancelModal) return;
    setCancelError(null);
    setCancelSaving(true);

    const res = await fetch(`/api/admin/orders/${cancelModal.id}/cancel`, { method: "POST" });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setCancelSaving(false);

    if (!res.ok) {
      setCancelError(json.error ?? "Could not cancel order.");
      return;
    }

    setCancelModal(null);
    setActionMessage("Order cancelled.");
    loadOrders();
  }

  function renderCard(row: OrderRow) {
    const isBusy = busyOrderId === row.id;

    return (
      <div
        key={row.id}
        className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
      >
        <div className="flex items-center justify-between">
          <span className="font-medium">
            {row.orderNumber ? `#${row.orderNumber}` : "-"}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize dark:bg-gray-800">
            {row.channel}
          </span>
        </div>

        <p className="mt-1">
          {row.customerName ?? "-"}
          {row.customerPhone && (
            <span className="block text-xs text-gray-500">{row.customerPhone}</span>
          )}
        </p>

        <p className="mt-1 text-xs text-gray-500 capitalize">
          {row.fulfilmentType} — {formatDate(row.fulfilmentDate)}
        </p>

        <p className="mt-1 text-xs text-gray-500">
          {formatMoney(row.total)} total
          {row.depositPaid > 0 && ` · ${formatMoney(row.depositPaid)} deposit paid`}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {row.status === "booking_confirmed" && (
            <>
              <button
                type="button"
                onClick={() => runAction(row.id, "start-preparing", "Order moved to Preparing.")}
                disabled={isBusy}
                className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
              >
                {isBusy ? "Saving..." : "Start Preparing"}
              </button>
              <Link
                href="/admin/production/schedule"
                className="min-h-11 rounded border border-gray-300 px-3 text-xs leading-[2.75rem] dark:border-gray-700"
              >
                View Schedule ({formatDate(row.fulfilmentDate)})
              </Link>
              <button
                type="button"
                onClick={() => openCancelModal(row)}
                disabled={isBusy}
                className="min-h-11 rounded border border-red-300 px-3 text-xs text-red-600 disabled:opacity-40"
              >
                Cancel Order
              </button>
            </>
          )}

          {row.status === "preparing" && (
            <button
              type="button"
              onClick={() => runAction(row.id, "mark-ready", "Order marked Ready.")}
              disabled={isBusy}
              className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
            >
              {isBusy ? "Saving..." : "Mark Ready"}
            </button>
          )}

          {row.status === "ready" && (
            <button
              type="button"
              onClick={() =>
                runAction(
                  row.id,
                  "mark-fulfilled",
                  row.fulfilmentType === "delivery"
                    ? "Order marked Delivered."
                    : "Order marked Picked Up."
                )
              }
              disabled={isBusy}
              className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
            >
              {isBusy
                ? "Saving..."
                : row.fulfilmentType === "delivery"
                ? "Mark Delivered"
                : "Mark Picked Up"}
            </button>
          )}

          {row.status === "delivered" && (
            <button
              type="button"
              onClick={() => runAction(row.id, "mark-completed", "Order marked Completed.")}
              disabled={isBusy}
              className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
            >
              {isBusy ? "Saving..." : "Mark Completed"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}
      {actionMessage && (
        <p className="mt-4 rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {actionMessage}
        </p>
      )}
      {actionError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading...</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 overflow-x-auto sm:grid-cols-2 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const columnOrders = orders.filter((o) => o.status === col.key);
            return (
              <div
                key={col.key}
                className="min-w-0 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
              >
                <h2 className="text-sm font-medium">
                  {col.label}{" "}
                  <span className="text-xs font-normal text-gray-500">
                    ({columnOrders.length})
                  </span>
                </h2>
                <div className="mt-3 space-y-3">
                  {columnOrders.length === 0 ? (
                    <p className="text-xs text-gray-500">No orders.</p>
                  ) : (
                    columnOrders.map((row) => renderCard(row))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cancelModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">Cancel Order</h2>
            <p className="mt-2 text-sm">
              This cancels order {cancelModal.orderNumber ? `#${cancelModal.orderNumber}` : ""}{" "}
              and frees its reserved stock.
              {cancelModal.depositPaid > 0 && (
                <>
                  {" "}
                  A deposit of {formatMoney(cancelModal.depositPaid)} was paid — this will be
                  flagged for manual refund review, not refunded automatically.
                </>
              )}
            </p>

            {cancelError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {cancelError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCancelModal(null)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={cancelSaving}
                className="min-h-11 w-full rounded bg-red-600 text-sm font-medium text-white disabled:opacity-40"
              >
                {cancelSaving ? "Saving..." : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
