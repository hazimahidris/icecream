"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type IngredientRow = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  qtyOnHand: number;
  lowStockThreshold: number;
  isSundry: boolean;
  lastUpdated: string | null;
};

type Status = "ok" | "low" | "out";

const REASON_OPTIONS = [
  { value: "restock", label: "Restock" },
  { value: "stock_take", label: "Stock-take adjustment" },
  { value: "wastage", label: "Wastage" },
  { value: "other", label: "Other" },
];

const STATUS_STYLES: Record<Status, string> = {
  ok: "text-green-600",
  low: "text-amber-600",
  out: "text-red-600",
};
const STATUS_LABELS: Record<Status, string> = {
  ok: "OK",
  low: "Low",
  out: "Out",
};

function ingredientStatus(qtyOnHand: number, threshold: number): Status {
  if (qtyOnHand <= 0) return "out";
  if (qtyOnHand < threshold) return "low";
  return "ok";
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

export default function IngredientInventoryPage() {
  const router = useRouter();

  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function loadIngredients() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/inventory/ingredients");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load ingredients.");
    } else {
      setIngredients(json.ingredients ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadIngredients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lowStockCount = useMemo(
    () =>
      ingredients.filter(
        (i) => ingredientStatus(i.qtyOnHand, i.lowStockThreshold) !== "ok"
      ).length,
    [ingredients]
  );

  const visibleIngredients = showLowStockOnly
    ? ingredients.filter(
        (i) => ingredientStatus(i.qtyOnHand, i.lowStockThreshold) !== "ok"
      )
    : ingredients;

  const sundryIngredients = ingredients.filter((i) => i.isSundry);

  function startEdit(row: IngredientRow) {
    setEditingId(row.id);
    setEditQty(String(row.qtyOnHand));
    setEditReason("");
    setEditNotes("");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(id: string) {
    setEditError(null);

    const newQty = Number(editQty);
    if (Number.isNaN(newQty) || newQty < 0) {
      setEditError("Enter a valid quantity.");
      return;
    }
    if (!editReason) {
      setEditError("Select a reason.");
      return;
    }

    setSavingEdit(true);
    const res = await fetch(`/api/admin/inventory/ingredients/${id}/adjust`, {
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
    loadIngredients();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ingredient Inventory</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowLowStockOnly((v) => !v)}
        className={`mt-6 min-h-11 w-full rounded-lg border p-4 text-left sm:w-64 ${
          showLowStockOnly
            ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
            : "border-gray-200 dark:border-gray-700"
        }`}
      >
        <p className="text-xs text-gray-500">Low Stock</p>
        <p className="text-2xl font-semibold">{lowStockCount}</p>
        <p className="text-xs text-gray-500">
          {showLowStockOnly ? "Showing low-stock only — click to clear" : "Click to filter"}
        </p>
      </button>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">All Ingredients</h2>
        {editError && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {editError}
          </p>
        )}

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : visibleIngredients.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            {showLowStockOnly ? "No low-stock ingredients." : "No ingredients found."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Category</th>
                  <th className="pb-2 pr-3">Unit</th>
                  <th className="pb-2 pr-3">Qty on Hand</th>
                  <th className="pb-2 pr-3">Threshold</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Last Updated</th>
                  <th className="pb-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleIngredients.map((row) => {
                  const status = ingredientStatus(row.qtyOnHand, row.lowStockThreshold);
                  const isEditing = editingId === row.id;

                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3 capitalize">{row.category ?? "-"}</td>
                        <td className="py-2 pr-3">{row.unit}</td>
                        <td className="py-2 pr-3">{row.qtyOnHand}</td>
                        <td className="py-2 pr-3">{row.lowStockThreshold}</td>
                        <td className={`py-2 pr-3 font-medium ${STATUS_STYLES[status]}`}>
                          {STATUS_LABELS[status]}
                        </td>
                        <td className="py-2 pr-3">
                          {row.isSundry && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
                              Manual
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{formatDate(row.lastUpdated)}</td>
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
                          <td colSpan={9} className="pb-4">
                            <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div>
                                  <label
                                    className="text-xs font-medium text-gray-500"
                                    htmlFor={`qty-${row.id}`}
                                  >
                                    New qty on hand
                                  </label>
                                  <input
                                    id={`qty-${row.id}`}
                                    type="number"
                                    step="0.01"
                                    value={editQty}
                                    onChange={(e) => setEditQty(e.target.value)}
                                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                                  />
                                </div>
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
                                    {REASON_OPTIONS.map((r) => (
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
                                  onClick={cancelEdit}
                                  className="min-h-11 rounded border border-gray-300 px-4 text-sm dark:border-gray-700"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(row.id)}
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

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Sundry Items</h2>
        <p className="mt-1 text-xs text-gray-500">
          These items are counted manually at monthly stock-take. Quantities
          shown are estimates only.
        </p>
        {sundryIngredients.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No sundry ingredients.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {sundryIngredients.map((row) => (
              <li key={row.id} className="flex justify-between gap-2">
                <span className="min-w-0 break-words">{row.name}</span>
                <span className="shrink-0 text-gray-500">
                  ~{row.qtyOnHand} {row.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
