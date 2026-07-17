"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type ForecastRow = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  isApproximate: boolean;
  qtyOnHand: number;
  qtyRequired: number;
  qtyToPurchase: number;
};

type PendingOrder = {
  id: string;
  ingredientName: string;
  unit: string;
  forecastDate: string;
  forecastHorizon: string;
  qtyRequired: number;
  qtyOnHand: number;
  qtyToPurchase: number;
  createdAt: string;
};

const HORIZON_OPTIONS = [7, 14] as const;

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

export default function PurchaseForecastPage() {
  const router = useRouter();

  const [horizonDays, setHorizonDays] = useState<7 | 14>(7);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [orderingId, setOrderingId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderConfirmation, setOrderConfirmation] = useState<string | null>(null);

  const [receiveModal, setReceiveModal] = useState<PendingOrder | null>(null);
  const [receiveQty, setReceiveQty] = useState("");
  const [savingReceive, setSavingReceive] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  async function loadData(days: number) {
    setLoading(true);
    setLoadError(null);

    const res = await fetch(`/api/admin/purchasing/forecast?horizonDays=${days}`);

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load purchase forecast.");
    } else {
      setForecast(json.forecast ?? []);
      setPendingOrders(json.pendingOrders ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData(horizonDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonDays]);

  async function handleMarkOrdered(row: ForecastRow) {
    setOrderError(null);
    setOrderConfirmation(null);
    setOrderingId(row.ingredientId);

    const res = await fetch("/api/admin/purchasing/forecast/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ingredientId: row.ingredientId,
        horizonDays,
        qtyOnHand: row.qtyOnHand,
        qtyRequired: row.qtyRequired,
        qtyToPurchase: row.qtyToPurchase,
      }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setOrderingId(null);

    if (!res.ok) {
      setOrderError(json.error ?? "Could not mark as ordered.");
      return;
    }

    setOrderConfirmation(
      "Marked as ordered. Update qty on hand in Ingredients when stock arrives."
    );
    loadData(horizonDays);
  }

  function openReceiveModal(row: PendingOrder) {
    setReceiveModal(row);
    setReceiveQty(String(row.qtyToPurchase));
    setReceiveError(null);
  }

  async function handleConfirmReceive() {
    if (!receiveModal) return;
    setReceiveError(null);

    const qty = Number(receiveQty);
    if (Number.isNaN(qty) || qty <= 0) {
      setReceiveError("Enter a valid quantity received.");
      return;
    }

    setSavingReceive(true);
    const res = await fetch(`/api/admin/purchasing/forecast/${receiveModal.id}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qtyReceived: qty }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingReceive(false);

    if (!res.ok) {
      setReceiveError(json.error ?? "Could not mark as received.");
      return;
    }

    setReceiveModal(null);
    loadData(horizonDays);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Forecast</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <div className="mt-6 flex gap-2">
        {HORIZON_OPTIONS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => setHorizonDays(days)}
            className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${
              horizonDays === days
                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                : "border-gray-300 dark:border-gray-700"
            }`}
          >
            {days} days
          </button>
        ))}
      </div>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">
          Required for orders in next {horizonDays} days
        </h2>

        {orderConfirmation && (
          <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            {orderConfirmation}
          </p>
        )}
        {orderError && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {orderError}
          </p>
        )}

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : forecast.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No ingredients to forecast.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Ingredient</th>
                  <th className="pb-2 pr-3">Unit</th>
                  <th className="pb-2 pr-3">On Hand Now</th>
                  <th className="pb-2 pr-3">Required (Next {horizonDays}d)</th>
                  <th className="pb-2 pr-3">Recommended Purchase</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {forecast.map((row) => {
                  const needsPurchase = row.qtyToPurchase > 0;
                  return (
                    <tr key={row.ingredientId}>
                      <td className="py-2 pr-3">
                        {row.ingredientName}
                        {row.isApproximate && (
                          <span
                            title="Actual usage may vary"
                            className="ml-1 text-amber-600"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{row.unit}</td>
                      <td className="py-2 pr-3">{row.qtyOnHand}</td>
                      <td className="py-2 pr-3">{row.qtyRequired}</td>
                      <td className="py-2 pr-3">{row.qtyToPurchase}</td>
                      <td className="py-2 pr-3">
                        {needsPurchase ? (
                          <span className="font-medium text-amber-600">Buy</span>
                        ) : (
                          <span className="font-medium text-green-600">OK</span>
                        )}
                      </td>
                      <td className="py-2">
                        {needsPurchase && (
                          <button
                            type="button"
                            onClick={() => handleMarkOrdered(row)}
                            disabled={orderingId === row.ingredientId}
                            className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
                          >
                            {orderingId === row.ingredientId ? "Saving..." : "Mark as Ordered"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Pending Orders</h2>

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : pendingOrders.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No pending orders.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Ingredient</th>
                  <th className="pb-2 pr-3">Ordered On</th>
                  <th className="pb-2 pr-3">Qty To Purchase</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {pendingOrders.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3">{row.ingredientName}</td>
                    <td className="py-2 pr-3">{formatDate(row.createdAt)}</td>
                    <td className="py-2 pr-3">
                      {row.qtyToPurchase} {row.unit}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => openReceiveModal(row)}
                        className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                      >
                        Mark as Received
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-gray-500">
        Sundry items (garam, pewarna) are not included — count these at monthly stock-take.
      </p>

      {receiveModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">Mark as Received</h2>
            <p className="mt-1 text-xs text-gray-500">
              {receiveModal.ingredientName} — ordered {receiveModal.qtyToPurchase}{" "}
              {receiveModal.unit}
            </p>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="receive-qty">
              Qty received ({receiveModal.unit})
            </label>
            <input
              id="receive-qty"
              type="number"
              step="0.01"
              min={0}
              value={receiveQty}
              onChange={(e) => setReceiveQty(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />

            {receiveError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {receiveError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setReceiveModal(null)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReceive}
                disabled={savingReceive}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {savingReceive ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
