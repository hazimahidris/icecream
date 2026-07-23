"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type Discount = {
  id: string;
  code: string | null;
  type: "percent" | "flat" | "bulk_qty";
  value: number;
  min_qty: number | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  created_at: string;
};

type FormState = {
  code: string;
  type: "percent" | "flat" | "bulk_qty";
  value: string;
  minQty: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  code: "",
  type: "percent",
  value: "",
  minQty: "",
  validFrom: "",
  validTo: "",
  isActive: true,
};

const TYPE_LABELS: Record<Discount["type"], string> = {
  percent: "Percent",
  flat: "Flat",
  bulk_qty: "Bulk qty",
};

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

function describeValue(d: Discount) {
  if (d.type === "flat") return `RM${d.value}`;
  return `${d.value}%`;
}

function formToPayload(form: FormState) {
  return {
    code: form.code,
    type: form.type,
    value: form.value,
    minQty: form.type === "bulk_qty" ? form.minQty : null,
    validFrom: form.validFrom || null,
    validTo: form.validTo || null,
    isActive: form.isActive,
  };
}

function discountToForm(d: Discount): FormState {
  return {
    code: d.code ?? "",
    type: d.type,
    value: String(d.value),
    minQty: d.min_qty !== null ? String(d.min_qty) : "",
    validFrom: d.valid_from ?? "",
    validTo: d.valid_to ?? "",
    isActive: d.is_active,
  };
}

function DiscountFields({
  form,
  onChange,
  idPrefix,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div>
        <label className="text-xs font-medium text-gray-500" htmlFor={`${idPrefix}-code`}>
          Code (optional — blank for automatic bulk discounts)
        </label>
        <input
          id={`${idPrefix}-code`}
          type="text"
          value={form.code}
          onChange={(e) => onChange({ ...form, code: e.target.value.toUpperCase() })}
          placeholder="e.g. SAVE10"
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base uppercase dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500" htmlFor={`${idPrefix}-type`}>
          Type
        </label>
        <select
          id={`${idPrefix}-type`}
          value={form.type}
          onChange={(e) => onChange({ ...form, type: e.target.value as FormState["type"] })}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="percent">Percent</option>
          <option value="flat">Flat</option>
          <option value="bulk_qty">Bulk qty</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500" htmlFor={`${idPrefix}-value`}>
          Value ({form.type === "flat" ? "RM" : "%"})
        </label>
        <input
          id={`${idPrefix}-value`}
          type="number"
          step="0.01"
          min={0}
          value={form.value}
          onChange={(e) => onChange({ ...form, value: e.target.value })}
          placeholder={form.type === "flat" ? "e.g. 10" : "e.g. 10"}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {form.type === "bulk_qty" && (
        <div>
          <label className="text-xs font-medium text-gray-500" htmlFor={`${idPrefix}-minqty`}>
            Minimum qty
          </label>
          <input
            id={`${idPrefix}-minqty`}
            type="number"
            min={1}
            step={1}
            value={form.minQty}
            onChange={(e) => onChange({ ...form, minQty: e.target.value })}
            placeholder="e.g. 50"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-gray-500" htmlFor={`${idPrefix}-from`}>
          Valid from (optional)
        </label>
        <input
          id={`${idPrefix}-from`}
          type="date"
          value={form.validFrom}
          onChange={(e) => onChange({ ...form, validFrom: e.target.value })}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500" htmlFor={`${idPrefix}-to`}>
          Valid to (optional)
        </label>
        <input
          id={`${idPrefix}-to`}
          type="date"
          value={form.validTo}
          onChange={(e) => onChange({ ...form, validTo: e.target.value })}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      <label className="flex items-center gap-2 text-sm sm:col-span-3">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => onChange({ ...form, isActive: e.target.checked })}
        />
        Active
      </label>
    </div>
  );
}

export default function DiscountsPage() {
  const router = useRouter();

  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function loadDiscounts() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/discounts");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load discounts.");
    } else {
      setDiscounts(json.discounts ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadDiscounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    setCreateError(null);
    setCreating(true);

    const res = await fetch("/api/admin/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToPayload(createForm)),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setCreating(false);

    if (!res.ok) {
      setCreateError(json.error ?? "Could not create discount.");
      return;
    }

    setCreateForm(EMPTY_FORM);
    loadDiscounts();
  }

  function startEdit(d: Discount) {
    setEditingId(d.id);
    setEditForm(discountToForm(d));
    setEditError(null);
  }

  async function saveEdit(id: string, form: FormState) {
    setEditError(null);
    setSaving(true);

    const res = await fetch(`/api/admin/discounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToPayload(form)),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setEditError(json.error ?? "Could not save changes.");
      return;
    }

    setEditingId(null);
    loadDiscounts();
  }

  async function handleToggleActive(d: Discount) {
    await saveEdit(d.id, { ...discountToForm(d), isActive: !d.is_active });
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Discounts</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">New Discount</h2>
        <div className="mt-3">
          <DiscountFields form={createForm} onChange={setCreateForm} idPrefix="create" />
        </div>
        {createError && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {createError}
          </p>
        )}
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="mt-4 min-h-11 rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
        >
          {creating ? "Creating..." : "Create Discount"}
        </button>
      </section>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">All Discounts</h2>

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : discounts.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No discounts yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Code</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Value</th>
                  <th className="pb-2 pr-3">Min Qty</th>
                  <th className="pb-2 pr-3">Valid From</th>
                  <th className="pb-2 pr-3">Valid To</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {discounts.map((d) => {
                  const isEditing = editingId === d.id;
                  return (
                    <Fragment key={d.id}>
                      <tr>
                        <td className="py-2 pr-3">{d.code ?? <span className="text-gray-400">Automatic</span>}</td>
                        <td className="py-2 pr-3">{TYPE_LABELS[d.type]}</td>
                        <td className="py-2 pr-3">{describeValue(d)}</td>
                        <td className="py-2 pr-3">{d.min_qty ?? "-"}</td>
                        <td className="py-2 pr-3">{formatDate(d.valid_from)}</td>
                        <td className="py-2 pr-3">{formatDate(d.valid_to)}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={`font-medium ${
                              d.is_active ? "text-green-600" : "text-gray-400"
                            }`}
                          >
                            {d.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="py-2">
                          {!isEditing && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => startEdit(d)}
                                className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleActive(d)}
                                className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                              >
                                {d.is_active ? "Deactivate" : "Activate"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={8} className="pb-4">
                            <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                              <DiscountFields
                                form={editForm}
                                onChange={setEditForm}
                                idPrefix={`edit-${d.id}`}
                              />
                              {editError && (
                                <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                                  {editError}
                                </p>
                              )}
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
                                  onClick={() => saveEdit(d.id, editForm)}
                                  disabled={saving}
                                  className="min-h-11 rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
                                >
                                  {saving ? "Saving..." : "Save"}
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
    </main>
  );
}
