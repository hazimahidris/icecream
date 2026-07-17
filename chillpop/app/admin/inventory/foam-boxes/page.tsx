"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type RentalRow = {
  id: string;
  orderNumber: number | null;
  customerName: string | null;
  customerPhone: string | null;
  qty: number;
  returnQty: number;
  handedOutAt: string;
  dueDate: string;
  returnedAt: string | null;
  depositPaid: number;
  depositRefunded: number;
  status: string;
  isOverdue: boolean;
};

type UpcomingHandout = {
  orderId: string;
  orderNumber: number | null;
  orderStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  fulfilmentDate: string;
  qtyOrdered: number;
  depositToCollect: number;
  addonId: string;
  canHandOut: boolean;
};

type Summary = {
  totalUnits: number;
  available: number;
  rented: number;
  overdue: number;
  lost: number;
  depositOutstanding: number;
};

const STATUS_LABELS: Record<string, string> = {
  rented: "Rented",
  overdue: "Overdue",
  partial_return: "Partial Return",
  returned: "Returned",
  lost: "Lost",
};

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

function formatMoney(n: number) {
  return `RM ${n.toFixed(2)}`;
}

export default function FoamBoxTrackerPage() {
  const router = useRouter();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [upcomingHandouts, setUpcomingHandouts] = useState<UpcomingHandout[]>([]);
  const [activeRentals, setActiveRentals] = useState<RentalRow[]>([]);
  const [returnedRentals, setReturnedRentals] = useState<RentalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [handingOutId, setHandingOutId] = useState<string | null>(null);
  const [handoutError, setHandoutError] = useState<string | null>(null);
  const [handoutConfirmation, setHandoutConfirmation] = useState<string | null>(null);

  const [returnModal, setReturnModal] = useState<RentalRow | null>(null);
  const [returnQty, setReturnQty] = useState("");
  const [savingReturn, setSavingReturn] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const [lostModal, setLostModal] = useState<RentalRow | null>(null);
  const [savingLost, setSavingLost] = useState(false);
  const [lostError, setLostError] = useState<string | null>(null);

  const [refundModal, setRefundModal] = useState<RentalRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [savingRefund, setSavingRefund] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/inventory/foam-boxes");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load foam box data.");
    } else {
      setSummary(json.summary ?? null);
      setUpcomingHandouts(json.upcomingHandouts ?? []);
      setActiveRentals(json.activeRentals ?? []);
      setReturnedRentals(json.returnedRentals ?? []);
    }
    setLoading(false);
  }

  async function handleHandOut(row: UpcomingHandout) {
    setHandoutError(null);
    setHandoutConfirmation(null);
    setHandingOutId(row.orderId);

    const res = await fetch("/api/admin/inventory/foam-boxes/handout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: row.orderId, addonId: row.addonId }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setHandingOutId(null);

    if (!res.ok) {
      setHandoutError(json.error ?? "Could not hand out foam boxes.");
      return;
    }

    setHandoutConfirmation(
      `${json.qty} foam box(es) handed out. Deposit ${formatMoney(json.depositPaid)} collected.`
    );
    loadData();
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openReturnModal(row: RentalRow) {
    setReturnModal(row);
    setReturnQty(String(row.qty - row.returnQty));
    setReturnError(null);
  }

  async function handleConfirmReturn() {
    if (!returnModal) return;
    setReturnError(null);

    const qty = Number(returnQty);
    const remaining = returnModal.qty - returnModal.returnQty;
    if (!Number.isInteger(qty) || qty <= 0 || qty > remaining) {
      setReturnError(`Enter a whole number between 1 and ${remaining}.`);
      return;
    }

    setSavingReturn(true);
    const res = await fetch(`/api/admin/inventory/foam-boxes/${returnModal.id}/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnQty: qty }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingReturn(false);

    if (!res.ok) {
      setReturnError(json.error ?? "Could not record the return.");
      return;
    }

    setReturnModal(null);
    loadData();
  }

  function openLostModal(row: RentalRow) {
    setLostModal(row);
    setLostError(null);
  }

  async function handleConfirmLost() {
    if (!lostModal) return;
    setLostError(null);
    setSavingLost(true);

    const res = await fetch(`/api/admin/inventory/foam-boxes/${lostModal.id}/lost`, {
      method: "POST",
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingLost(false);

    if (!res.ok) {
      setLostError(json.error ?? "Could not mark this rental as lost.");
      return;
    }

    setLostModal(null);
    loadData();
  }

  function openRefundModal(row: RentalRow) {
    setRefundModal(row);
    setRefundAmount((row.depositPaid - row.depositRefunded).toFixed(2));
    setRefundError(null);
  }

  async function handleConfirmRefund() {
    if (!refundModal) return;
    setRefundError(null);

    const amount = Number(refundAmount);
    const outstanding = refundModal.depositPaid - refundModal.depositRefunded;
    if (Number.isNaN(amount) || amount <= 0 || amount > outstanding + 0.001) {
      setRefundError(`Enter an amount between RM 0.01 and ${formatMoney(outstanding)}.`);
      return;
    }

    setSavingRefund(true);
    const res = await fetch(`/api/admin/inventory/foam-boxes/${refundModal.id}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refundAmount: amount }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingRefund(false);

    if (!res.ok) {
      setRefundError(json.error ?? "Could not refund the deposit.");
      return;
    }

    setRefundModal(null);
    loadData();
  }

  function renderRentalRow(row: RentalRow, withActions: boolean) {
    const depositOutstanding = row.depositPaid - row.depositRefunded;

    return (
      <tr
        key={row.id}
        className={row.isOverdue ? "bg-red-50 dark:bg-red-950/40" : undefined}
      >
        <td className="py-2 pr-3">{row.orderNumber ? `#${row.orderNumber}` : "-"}</td>
        <td className="py-2 pr-3">
          {row.customerName ?? "-"}
          {row.customerPhone && (
            <span className="block text-xs text-gray-500">{row.customerPhone}</span>
          )}
        </td>
        <td className="py-2 pr-3">
          {row.qty}
          {row.returnQty > 0 && (
            <span className="block text-xs text-gray-500">{row.returnQty} returned</span>
          )}
        </td>
        <td className="py-2 pr-3">{formatDate(row.handedOutAt)}</td>
        <td className={`py-2 pr-3 ${row.isOverdue ? "font-medium text-red-600" : ""}`}>
          {formatDate(row.dueDate)}
        </td>
        <td className="py-2 pr-3">
          {formatMoney(row.depositPaid)}
          {row.depositRefunded > 0 && (
            <span className="block text-xs text-gray-500">
              {formatMoney(row.depositRefunded)} refunded
            </span>
          )}
        </td>
        <td className="py-2 pr-3">
          {STATUS_LABELS[row.status] ?? row.status}
        </td>
        {withActions && (
          <td className="py-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openReturnModal(row)}
                className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
              >
                Mark Returned
              </button>
              <button
                type="button"
                onClick={() => openLostModal(row)}
                className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
              >
                Mark Lost
              </button>
              {depositOutstanding > 0 && (
                <button
                  type="button"
                  onClick={() => openRefundModal(row)}
                  className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                >
                  Refund Deposit
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Foam Box Tracker</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}
      {summary && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="text-xs text-gray-500">Total Units</p>
            <p className="text-2xl font-semibold">{summary.totalUnits}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="text-xs text-gray-500">Available</p>
            <p className="text-2xl font-semibold">{summary.available}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="text-xs text-gray-500">Rented</p>
            <p className="text-2xl font-semibold">{summary.rented}</p>
          </div>
          <div
            className={`rounded-lg border p-4 ${
              summary.overdue > 0
                ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
                : "border-gray-200 dark:border-gray-700"
            }`}
          >
            <p className="text-xs text-gray-500">Overdue</p>
            <p
              className={`text-2xl font-semibold ${
                summary.overdue > 0 ? "text-red-600" : ""
              }`}
            >
              {summary.overdue}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="text-xs text-gray-500">Lost</p>
            <p className="text-2xl font-semibold">{summary.lost}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="text-xs text-gray-500">Deposit Outstanding</p>
            <p className="text-2xl font-semibold">{formatMoney(summary.depositOutstanding)}</p>
          </div>
        </div>
      )}

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Upcoming Handouts</h2>
        <p className="mt-1 text-xs text-gray-500">
          Orders that ordered a foam box rental and haven&apos;t had boxes handed out yet.
          &quot;Hand Out&quot; unlocks once the order is Ready.
        </p>

        {handoutConfirmation && (
          <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            {handoutConfirmation}
          </p>
        )}
        {handoutError && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {handoutError}
          </p>
        )}

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : upcomingHandouts.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No upcoming handouts.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Order ID</th>
                  <th className="pb-2 pr-3">Customer</th>
                  <th className="pb-2 pr-3">Fulfilment Date</th>
                  <th className="pb-2 pr-3">Qty Boxes Ordered</th>
                  <th className="pb-2 pr-3">Deposit to Collect</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {upcomingHandouts.map((row) => (
                  <tr key={`${row.orderId}-${row.addonId}`}>
                    <td className="py-2 pr-3">
                      {row.orderNumber ? `#${row.orderNumber}` : "-"}
                    </td>
                    <td className="py-2 pr-3">
                      {row.customerName ?? "-"}
                      {row.customerPhone && (
                        <span className="block text-xs text-gray-500">{row.customerPhone}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{formatDate(row.fulfilmentDate)}</td>
                    <td className="py-2 pr-3">{row.qtyOrdered}</td>
                    <td className="py-2 pr-3">{formatMoney(row.depositToCollect)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => handleHandOut(row)}
                        disabled={!row.canHandOut || handingOutId === row.orderId}
                        title={row.canHandOut ? undefined : "Order must be Ready first"}
                        className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
                      >
                        {handingOutId === row.orderId ? "Handing out..." : "Hand Out"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Active Rentals</h2>

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : activeRentals.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No active rentals.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Order ID</th>
                  <th className="pb-2 pr-3">Customer</th>
                  <th className="pb-2 pr-3">Qty Rented</th>
                  <th className="pb-2 pr-3">Handed Out Date</th>
                  <th className="pb-2 pr-3">Due Date</th>
                  <th className="pb-2 pr-3">Deposit Paid</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {activeRentals.map((row) => renderRentalRow(row, true))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Returned Rentals (Last 30 Days)</h2>
        <p className="mt-1 text-xs text-gray-500">Reference only.</p>

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : returnedRentals.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No returns in the last 30 days.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Order ID</th>
                  <th className="pb-2 pr-3">Customer</th>
                  <th className="pb-2 pr-3">Qty Rented</th>
                  <th className="pb-2 pr-3">Handed Out Date</th>
                  <th className="pb-2 pr-3">Due Date</th>
                  <th className="pb-2 pr-3">Deposit Paid</th>
                  <th className="pb-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {returnedRentals.map((row) => renderRentalRow(row, false))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {returnModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">Mark Returned</h2>
            <p className="mt-1 text-xs text-gray-500">
              {returnModal.qty - returnModal.returnQty} unit(s) still outstanding on this rental.
            </p>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="return-qty">
              Qty returned
            </label>
            <input
              id="return-qty"
              type="number"
              step={1}
              min={1}
              max={returnModal.qty - returnModal.returnQty}
              inputMode="numeric"
              value={returnQty}
              onChange={(e) => setReturnQty(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              A partial return leaves the remainder marked as rented.
            </p>

            {returnError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {returnError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setReturnModal(null)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={savingReturn}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {savingReturn ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {lostModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">Mark Lost</h2>
            <p className="mt-2 text-sm">
              This marks {lostModal.qty - lostModal.returnQty} unit(s) as lost. The deposit of{" "}
              {formatMoney(lostModal.depositPaid - lostModal.depositRefunded)} will be forfeited
              and will not be refunded.
            </p>

            {lostError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {lostError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setLostModal(null)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLost}
                disabled={savingLost}
                className="min-h-11 w-full rounded bg-red-600 text-sm font-medium text-white disabled:opacity-40"
              >
                {savingLost ? "Saving..." : "Confirm Lost"}
              </button>
            </div>
          </div>
        </div>
      )}

      {refundModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">Refund Deposit</h2>
            <p className="mt-1 text-xs text-gray-500">
              Outstanding deposit:{" "}
              {formatMoney(refundModal.depositPaid - refundModal.depositRefunded)}
            </p>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="refund-amount">
              Refund amount (RM)
            </label>
            <input
              id="refund-amount"
              type="number"
              step="0.01"
              min={0}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />

            {refundError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {refundError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRefundModal(null)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRefund}
                disabled={savingRefund}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {savingRefund ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
