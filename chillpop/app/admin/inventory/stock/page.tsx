"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type ProductStockRow = {
  id: string;
  name: string;
  category: string | null;
  qtyOnHand: number;
  reservedQty: number;
  availableQty: number | null;
  maxDailyQty: number | null;
  todayScheduledQty: number;
};

// Explicitly called out as configurable in the spec — change this
// single constant to adjust the low-stock cutoff everywhere on this page.
const LOW_STOCK_THRESHOLD = 10;

const ADJUST_REASONS = [
  { value: "restock", label: "Restock" },
  { value: "stock_take", label: "Stock-take adjustment" },
  { value: "wastage", label: "Wastage" },
  { value: "other", label: "Other" },
];

const WASTAGE_REASONS = ["Melted", "Expired", "Quality reject", "Other"];

export default function FinishedGoodsStockPage() {
  const router = useRouter();

  const [products, setProducts] = useState<ProductStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"delta" | "exact">("delta");
  const [editDeltaDirection, setEditDeltaDirection] = useState<"add" | "deduct">("add");
  const [editDeltaAmount, setEditDeltaAmount] = useState("");
  const [editExactQty, setEditExactQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [showWastageModal, setShowWastageModal] = useState(false);
  const [wastageProductId, setWastageProductId] = useState("");
  const [wastageQty, setWastageQty] = useState("");
  const [wastageReason, setWastageReason] = useState("");
  const [savingWastage, setSavingWastage] = useState(false);
  const [wastageError, setWastageError] = useState<string | null>(null);

  async function loadStock() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/inventory/stock");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load stock.");
    } else {
      setProducts(json.products ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const productionImpact = products.filter((p) => p.todayScheduledQty > 0);

  function startEdit(row: ProductStockRow) {
    setEditingId(row.id);
    setEditMode("delta");
    setEditDeltaDirection("add");
    setEditDeltaAmount("");
    setEditExactQty(String(row.qtyOnHand));
    setEditReason("");
    setEditNotes("");
    setEditError(null);
  }

  // Delta mode types the amount you actually know (received / wasted);
  // exact mode types the final counted number (stock-take). Either way
  // this resolves to the one absolute value the API expects, so the
  // person editing never has to do the arithmetic themselves.
  function resolveNewQty(currentQty: number): number | null {
    if (editMode === "exact") {
      const val = Number(editExactQty);
      return Number.isNaN(val) ? null : val;
    }
    const amount = Number(editDeltaAmount);
    if (Number.isNaN(amount)) return null;
    return editDeltaDirection === "add" ? currentQty + amount : currentQty - amount;
  }

  async function handleSaveEdit(id: string, currentQty: number) {
    setEditError(null);
    const newQty = resolveNewQty(currentQty);
    if (newQty === null || !Number.isInteger(newQty) || newQty < 0) {
      setEditError("Enter a valid whole number quantity.");
      return;
    }
    if (!editReason) {
      setEditError("Select a reason.");
      return;
    }

    setSavingEdit(true);
    const res = await fetch(`/api/admin/inventory/stock/${id}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newQty, reason: editReason, notes: editNotes }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingEdit(false);

    if (!res.ok) {
      setEditError(json.error ?? "Could not save adjustment.");
      return;
    }

    setEditingId(null);
    loadStock();
  }

  function openWastageModal() {
    setWastageProductId("");
    setWastageQty("");
    setWastageReason("");
    setWastageError(null);
    setShowWastageModal(true);
  }

  async function handleSaveWastage() {
    setWastageError(null);

    if (!wastageProductId) {
      setWastageError("Select a flavour.");
      return;
    }
    const qty = Number(wastageQty);
    if (!Number.isInteger(qty) || qty <= 0) {
      setWastageError("Enter a valid whole number quantity.");
      return;
    }
    if (!wastageReason) {
      setWastageError("Select a reason.");
      return;
    }

    setSavingWastage(true);
    const res = await fetch(`/api/admin/inventory/stock/${wastageProductId}/wastage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qtyWasted: qty, wastageReason }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingWastage(false);

    if (!res.ok) {
      setWastageError(json.error ?? "Could not log wastage.");
      return;
    }

    setShowWastageModal(false);
    loadStock();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Finished Goods Stock</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <button
        type="button"
        onClick={openWastageModal}
        className="mt-6 min-h-11 rounded border border-gray-300 px-4 text-sm font-medium dark:border-gray-700"
      >
        Wastage Log
      </button>

      {productionImpact.length > 0 && (
        <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h2 className="text-sm font-medium">Today&apos;s Production Impact</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {productionImpact.map((p) => (
              <li key={p.id}>
                After today&apos;s scheduled production: {p.name} will have{" "}
                <span className="font-medium">
                  {p.qtyOnHand + p.todayScheduledQty}
                </span>{" "}
                pcs on hand
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">All Flavours</h2>
        {editError && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {editError}
          </p>
        )}

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : products.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No active products.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Flavour</th>
                  <th className="pb-2 pr-3">Category</th>
                  <th className="pb-2 pr-3">On Hand</th>
                  <th className="pb-2 pr-3">Reserved</th>
                  <th className="pb-2 pr-3">Available</th>
                  <th className="pb-2 pr-3">Max Daily</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {products.map((row) => {
                  const isLow = row.qtyOnHand < LOW_STOCK_THRESHOLD;
                  const isEditing = editingId === row.id;

                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3">{row.category ?? "-"}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={
                              isLow ? "font-medium text-red-600" : undefined
                            }
                          >
                            {row.qtyOnHand}
                          </span>
                          {isLow && (
                            <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                              Low
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{row.reservedQty}</td>
                        <td className="py-2 pr-3">
                          {row.availableQty ?? "-"}
                        </td>
                        <td className="py-2 pr-3">
                          {row.maxDailyQty ?? "-"}
                        </td>
                        <td className="py-2">
                          {!isEditing && (
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={7} className="pb-4">
                            <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                              <p className="text-xs text-gray-500">
                                Current qty on hand: <span className="font-medium">{row.qtyOnHand}</span>
                              </p>

                              <div className="mt-2 flex gap-4 text-sm">
                                <label className="flex items-center gap-1.5">
                                  <input
                                    type="radio"
                                    name={`mode-${row.id}`}
                                    checked={editMode === "delta"}
                                    onChange={() => setEditMode("delta")}
                                  />
                                  Add / Deduct
                                </label>
                                <label className="flex items-center gap-1.5">
                                  <input
                                    type="radio"
                                    name={`mode-${row.id}`}
                                    checked={editMode === "exact"}
                                    onChange={() => setEditMode("exact")}
                                  />
                                  Set exact count
                                </label>
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                {editMode === "delta" ? (
                                  <div className="sm:col-span-2">
                                    <span className="text-xs font-medium text-gray-500">Amount</span>
                                    <div className="mt-1 flex gap-2">
                                      <div className="flex overflow-hidden rounded border border-gray-300 dark:border-gray-700">
                                        <button
                                          type="button"
                                          onClick={() => setEditDeltaDirection("add")}
                                          className={`min-h-11 w-11 text-lg font-medium ${
                                            editDeltaDirection === "add"
                                              ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                                              : ""
                                          }`}
                                        >
                                          +
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditDeltaDirection("deduct")}
                                          className={`min-h-11 w-11 border-l border-gray-300 text-lg font-medium dark:border-gray-700 ${
                                            editDeltaDirection === "deduct"
                                              ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                                              : ""
                                          }`}
                                        >
                                          −
                                        </button>
                                      </div>
                                      <input
                                        type="number"
                                        step={1}
                                        min={0}
                                        inputMode="numeric"
                                        value={editDeltaAmount}
                                        onChange={(e) => setEditDeltaAmount(e.target.value)}
                                        className="block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                                      />
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500">
                                      New qty on hand: {row.qtyOnHand}{" "}
                                      {editDeltaDirection === "add" ? "+" : "−"}{" "}
                                      {editDeltaAmount || 0} ={" "}
                                      <span className="font-medium text-gray-900 dark:text-gray-100">
                                        {resolveNewQty(row.qtyOnHand) ?? "-"}
                                      </span>
                                    </p>
                                  </div>
                                ) : (
                                  <div className="sm:col-span-2">
                                    <label
                                      className="text-xs font-medium text-gray-500"
                                      htmlFor={`qty-${row.id}`}
                                    >
                                      New qty on hand
                                    </label>
                                    <input
                                      id={`qty-${row.id}`}
                                      type="number"
                                      step={1}
                                      min={0}
                                      inputMode="numeric"
                                      value={editExactQty}
                                      onChange={(e) => setEditExactQty(e.target.value)}
                                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">
                                      {(() => {
                                        const resolved = resolveNewQty(row.qtyOnHand);
                                        if (resolved === null) return null;
                                        const change = resolved - row.qtyOnHand;
                                        return `Will adjust by ${change >= 0 ? "+" : ""}${change}`;
                                      })()}
                                    </p>
                                  </div>
                                )}
                                <div>
                                  <label
                                    className="text-xs font-medium text-gray-500"
                                    htmlFor={`reason-${row.id}`}
                                  >
                                    Reason
                                  </label>
                                  <select
                                    id={`reason-${row.id}`}
                                    value={editReason}
                                    onChange={(e) => setEditReason(e.target.value)}
                                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                                  >
                                    <option value="">Select a reason</option>
                                    {ADJUST_REASONS.map((r) => (
                                      <option key={r.value} value={r.value}>
                                        {r.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label
                                    className="text-xs font-medium text-gray-500"
                                    htmlFor={`notes-${row.id}`}
                                  >
                                    Notes (optional)
                                  </label>
                                  <input
                                    id={`notes-${row.id}`}
                                    type="text"
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                                  />
                                </div>
                              </div>
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="min-h-11 rounded border border-gray-300 px-4 text-sm dark:border-gray-700"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(row.id, row.qtyOnHand)}
                                  disabled={savingEdit}
                                  className="min-h-11 rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
                                >
                                  {savingEdit ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showWastageModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">Log Wastage</h2>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="wastage-product">
              Flavour
            </label>
            <select
              id="wastage-product"
              value={wastageProductId}
              onChange={(e) => setWastageProductId(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">Select a flavour</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="wastage-qty">
              Qty wasted
            </label>
            <input
              id="wastage-qty"
              type="number"
              min={1}
              value={wastageQty}
              onChange={(e) => setWastageQty(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="wastage-reason">
              Reason
            </label>
            <select
              id="wastage-reason"
              value={wastageReason}
              onChange={(e) => setWastageReason(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">Select a reason</option>
              {WASTAGE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {wastageError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {wastageError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowWastageModal(false)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveWastage}
                disabled={savingWastage}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {savingWastage ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
