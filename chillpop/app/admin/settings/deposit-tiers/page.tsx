"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AdminLogout } from "@/components/AdminLogout";

type DepositTier = {
  id: string;
  min_amount: number;
  max_amount: number | null;
  deposit_type: string;
  deposit_value: number;
  label: string | null;
  sort_order: number;
};

export default function DepositTiersPage() {
  const [tiers, setTiers] = useState<DepositTier[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function loadTiers() {
      setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from("deposit_tiers")
        .select(
          "id, min_amount, max_amount, deposit_type, deposit_value, label, sort_order"
        )
        .order("sort_order");

      if (error) {
        setLoadError(error.message);
      } else {
        const rows = (data ?? []) as DepositTier[];
        setTiers(rows);
        setDrafts(
          Object.fromEntries(rows.map((t) => [t.id, String(t.deposit_value)]))
        );
      }

      setLoading(false);
    }

    loadTiers();
  }, []);

  function handleDraftChange(id: string, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    const changed = tiers
      .map((tier) => ({ tier, value: Number(drafts[tier.id]) }))
      .filter(
        ({ tier, value }) => !Number.isNaN(value) && value !== tier.deposit_value
      );

    if (changed.length === 0) {
      setSaving(false);
      setSaved(true);
      return;
    }

    const results = await Promise.all(
      changed.map(({ tier, value }) =>
        supabase
          .from("deposit_tiers")
          .update({ deposit_value: value })
          .eq("id", tier.id)
      )
    );

    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setSaveError(failed.error.message);
    } else {
      setTiers((prev) =>
        prev.map((tier) => {
          const update = changed.find((c) => c.tier.id === tier.id);
          return update ? { ...tier, deposit_value: update.value } : tier;
        })
      );
      setSaved(true);
    }

    setSaving(false);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deposit Tiers</h1>
        <AdminLogout />
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Edit the deposit value required for each order total range.
      </p>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Error loading deposit tiers: {loadError}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Label</th>
              <th className="px-4 py-2 text-left font-medium">Min Amount</th>
              <th className="px-4 py-2 text-left font-medium">Max Amount</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-left font-medium">Deposit Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr>
                <td className="px-4 py-3 text-gray-500" colSpan={5}>
                  Loading...
                </td>
              </tr>
            ) : tiers.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-gray-500" colSpan={5}>
                  No deposit tiers found.
                </td>
              </tr>
            ) : (
              tiers.map((tier) => (
                <tr key={tier.id}>
                  <td className="px-4 py-2">{tier.label ?? "-"}</td>
                  <td className="px-4 py-2">
                    RM{Number(tier.min_amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    {tier.max_amount === null
                      ? "No limit"
                      : `RM${Number(tier.max_amount).toFixed(2)}`}
                  </td>
                  <td className="px-4 py-2 capitalize">{tier.deposit_type}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={drafts[tier.id] ?? ""}
                        onChange={(e) =>
                          handleDraftChange(tier.id, e.target.value)
                        }
                        className="w-24 rounded border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
                      />
                      <span className="text-gray-500">%</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>

        {saved && (
          <span className="text-sm text-green-600">Saved successfully.</span>
        )}
        {saveError && (
          <span className="text-sm text-red-600">Error saving: {saveError}</span>
        )}
      </div>
    </main>
  );
}
