"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type Schedule = {
  id: string;
  productId: string | null;
  productName: string;
  qtyPlanned: number;
  startTime: string | null;
  completeBy: string | null;
  packagingTime: string | null;
  status: "queued" | "in_production";
};

type IngredientPullRow = {
  ingredient_id: string;
  name: string;
  unit: string;
  qty_needed: number;
  qty_on_hand: number;
};

type ConfirmState = { scheduleId: string; productName: string; qty: number } | null;

function formatTimeLabel(time: string | null) {
  if (!time) return "-";
  let h = Number(time.split(":")[0]);
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  const minutes = time.split(":")[1];
  return `${h}:${minutes} ${period}`;
}

function formatStatus(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// "low" isn't numerically defined beyond the spec's explicit "red if
// qty_needed > qty_on_hand" — this treats anything with less than a
// 20% buffer above what's needed as "low" (amber). Adjust here if a
// different margin is intended.
function ingredientStatus(needed: number, onHand: number): "enough" | "low" | "short" {
  if (onHand < needed) return "short";
  if (onHand < needed * 1.2) return "low";
  return "enough";
}

const STATUS_STYLES: Record<string, string> = {
  enough: "text-green-600",
  low: "text-amber-600",
  short: "text-red-600",
};

export default function ProductionDashboardPage() {
  const router = useRouter();

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [ingredientPull, setIngredientPull] = useState<IngredientPullRow[]>([]);
  const [plannedQty, setPlannedQty] = useState(0);
  const [maxCapacity, setMaxCapacity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [startingId, setStartingId] = useState<string | null>(null);
  const [producingId, setProducingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  async function loadToday() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/production/today");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();

    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load production data.");
    } else {
      setSchedules(json.schedules ?? []);
      setIngredientPull(json.ingredientPull ?? []);
      setPlannedQty(json.plannedQty ?? 0);
      setMaxCapacity(json.maxCapacity ?? null);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart(scheduleId: string) {
    setActionError(null);
    setStartingId(scheduleId);

    const res = await fetch(`/api/admin/production/${scheduleId}/start`, {
      method: "POST",
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setStartingId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Could not start production.");
      return;
    }

    loadToday();
  }

  async function handleConfirmProduced() {
    if (!confirmState) return;
    setActionError(null);
    setProducingId(confirmState.scheduleId);

    const res = await fetch(
      `/api/admin/production/${confirmState.scheduleId}/produce`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qtyProduced: confirmState.qty }),
      }
    );

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setProducingId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Could not mark as produced.");
      setConfirmState(null);
      return;
    }

    setSuccessMessage(
      `${confirmState.qty} pcs ${confirmState.productName} produced. Ingredients deducted. Stock updated.`
    );
    setConfirmState(null);
    loadToday();
  }

  const capacityPct = maxCapacity ? (plannedQty / maxCapacity) * 100 : null;
  const capacityColour =
    capacityPct === null
      ? "text-gray-500"
      : capacityPct > 100
        ? "text-red-600"
        : capacityPct >= 80
          ? "text-amber-600"
          : "text-green-600";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Production Dashboard</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}
      {actionError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {successMessage && (
        <p className="mt-4 rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {successMessage}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading...</p>
      ) : (
        <>
          {/* Section 3 — Capacity check (shown up top for visibility) */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Today&apos;s Capacity</h2>
            <p className={`mt-1 text-lg font-medium ${capacityColour}`}>
              {plannedQty} pcs planned
              {maxCapacity !== null ? ` / ${maxCapacity} pcs max capacity` : ""}
            </p>
            {maxCapacity === null && (
              <p className="text-xs text-gray-500">
                No capacity configured for today in production_capacity_config.
              </p>
            )}
          </section>

          {/* Section 1 — Today's production targets */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Today&apos;s Production Targets</h2>
            {schedules.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">
                Nothing queued or in production today.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {schedules.map((s) => (
                  <li
                    key={s.id}
                    className="rounded border border-gray-100 p-3 text-sm dark:border-gray-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {s.productName} — {s.qtyPlanned} pcs
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatStatus(s.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Start {formatTimeLabel(s.startTime)} · Complete by{" "}
                      {formatTimeLabel(s.completeBy)} · Packaging{" "}
                      {formatTimeLabel(s.packagingTime)}
                    </p>

                    <div className="mt-2 flex gap-2">
                      {s.status === "queued" && (
                        <button
                          type="button"
                          onClick={() => handleStart(s.id)}
                          disabled={startingId === s.id}
                          className="min-h-11 rounded border border-gray-300 px-3 text-sm font-medium disabled:opacity-40 dark:border-gray-700"
                        >
                          {startingId === s.id ? "Starting..." : "Start Production"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmState({
                            scheduleId: s.id,
                            productName: s.productName,
                            qty: s.qtyPlanned,
                          })
                        }
                        disabled={producingId === s.id}
                        className="min-h-11 rounded bg-gray-900 px-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
                      >
                        Mark as Produced
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Section 2 — Ingredient pull list */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Ingredient Pull List</h2>
            {ingredientPull.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">
                No ingredients needed for today&apos;s schedule.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-2">Ingredient</th>
                      <th className="pb-2 pr-2">Needed</th>
                      <th className="pb-2 pr-2">On Hand</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {ingredientPull.map((row) => {
                      const status = ingredientStatus(row.qty_needed, row.qty_on_hand);
                      return (
                        <tr key={row.ingredient_id}>
                          <td className="py-2 pr-2">{row.name}</td>
                          <td className="py-2 pr-2">
                            {row.qty_needed.toFixed(2)} {row.unit}
                          </td>
                          <td className="py-2 pr-2">
                            {row.qty_on_hand.toFixed(2)} {row.unit}
                          </td>
                          <td className={`py-2 font-medium ${STATUS_STYLES[status]}`}>
                            {status === "enough"
                              ? "Enough"
                              : status === "low"
                                ? "Low"
                                : "Short"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {confirmState && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <p className="text-sm">
              Confirm {confirmState.qty} pcs {confirmState.productName} produced?
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="min-h-11 w-full rounded border border-gray-300 px-4 text-sm font-medium dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmProduced}
                disabled={producingId === confirmState.scheduleId}
                className="min-h-11 w-full rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {producingId === confirmState.scheduleId ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
