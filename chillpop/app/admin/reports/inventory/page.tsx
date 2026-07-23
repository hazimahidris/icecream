"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type StockMovementRow = {
  productId: string;
  name: string;
  opening: number;
  produced: number;
  soldPos: number;
  soldOnline: number;
  soldTotal: number;
  wasted: number;
  closing: number;
};

type WastageRow = {
  id: string;
  date: string;
  flavourName: string;
  qty: number;
  reason: string;
  recordedBy: string;
  value: number;
};

type IngredientUsageRow = {
  ingredientId: string;
  name: string;
  unit: string;
  deducted: number;
  restocked: number;
  variance: number;
};

type ReportData = {
  range: { start: string; end: string };
  stockMovement: StockMovementRow[];
  wastageLog: WastageRow[];
  totalWastageValue: number;
  ingredientUsage: IngredientUsageRow[];
};

type RangeType = "today" | "week" | "month" | "year" | "custom";

const RANGE_OPTIONS: { key: RangeType; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom range" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOfWeekISO(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function computeRange(type: RangeType, customStart: string, customEnd: string) {
  const today = todayISO();
  const [year, month] = today.split("-").map(Number);

  switch (type) {
    case "today":
      return { start: today, end: today };
    case "week": {
      const monday = mondayOfWeekISO(today);
      return { start: monday, end: addDaysISO(monday, 6) };
    }
    case "month": {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { start, end };
    }
    case "year":
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    case "custom":
      return { start: customStart || today, end: customEnd || today };
  }
}

function formatMoney(n: number) {
  return `RM ${n.toFixed(2)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

export default function InventoryReportPage() {
  const router = useRouter();

  const [rangeType, setRangeType] = useState<RangeType>("month");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  const { start, end } = useMemo(
    () => computeRange(rangeType, customStart, customEnd),
    [rangeType, customStart, customEnd]
  );

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const res = await fetch(`/api/admin/reports/inventory?start=${start}&end=${end}`);

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load report.");
    } else {
      setData(json);
    }
    setLoading(false);
  }, [start, end, router]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory Report</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setRangeType(opt.key)}
            className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${
              rangeType === opt.key
                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                : "border-gray-300 dark:border-gray-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {rangeType === "custom" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="custom-start" className="text-xs text-gray-500">
            From
          </label>
          <input
            id="custom-start"
            type="date"
            value={customStart}
            max={customEnd}
            onChange={(e) => setCustomStart(e.target.value)}
            className="min-h-11 rounded border border-gray-300 px-2 dark:border-gray-700 dark:bg-gray-900"
          />
          <label htmlFor="custom-end" className="text-xs text-gray-500">
            To
          </label>
          <input
            id="custom-end"
            type="date"
            value={customEnd}
            min={customStart}
            max={todayISO()}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="min-h-11 rounded border border-gray-300 px-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
      )}

      {loading || !data ? (
        <p className="mt-6 text-sm text-gray-500">Loading...</p>
      ) : (
        <>
          {/* Section 1 */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Stock Movement Summary</h2>
            <p className="mt-1 text-xs text-gray-500">
              &quot;Closing&quot; is current qty on hand — accurate as the end-of-period figure
              only when the range ends today. &quot;Opening&quot; is derived from closing minus
              this period&apos;s produced/sold/wasted movements, since the system doesn&apos;t
              keep a dated stock ledger.
            </p>
            {data.stockMovement.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No products found.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Flavour</th>
                      <th className="pb-2 pr-3">Opening</th>
                      <th className="pb-2 pr-3">Produced</th>
                      <th className="pb-2 pr-3">Sold (POS)</th>
                      <th className="pb-2 pr-3">Sold (Online)</th>
                      <th className="pb-2 pr-3">Sold Total</th>
                      <th className="pb-2 pr-3">Wasted</th>
                      <th className="pb-2">Closing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.stockMovement.map((row) => (
                      <tr key={row.productId}>
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3">{row.opening}</td>
                        <td className="py-2 pr-3">{row.produced}</td>
                        <td className="py-2 pr-3">{row.soldPos}</td>
                        <td className="py-2 pr-3">{row.soldOnline}</td>
                        <td className="py-2 pr-3">{row.soldTotal}</td>
                        <td className="py-2 pr-3">{row.wasted}</td>
                        <td className="py-2 font-medium">{row.closing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 2 */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Wastage Log</h2>
              <p className="text-sm font-medium">
                Total value: {formatMoney(data.totalWastageValue)}
              </p>
            </div>
            {data.wastageLog.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No wastage recorded in this period.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Date</th>
                      <th className="pb-2 pr-3">Flavour</th>
                      <th className="pb-2 pr-3">Qty</th>
                      <th className="pb-2 pr-3">Reason</th>
                      <th className="pb-2 pr-3">Recorded By</th>
                      <th className="pb-2">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.wastageLog.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-3">{formatDate(row.date)}</td>
                        <td className="py-2 pr-3">{row.flavourName}</td>
                        <td className="py-2 pr-3">{row.qty}</td>
                        <td className="py-2 pr-3">{row.reason}</td>
                        <td className="py-2 pr-3">{row.recordedBy}</td>
                        <td className="py-2">{formatMoney(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 3 */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Ingredient Usage vs Purchased</h2>
            <p className="mt-1 text-xs text-gray-500">
              &quot;Deducted&quot; is the theoretical usage recomputed from production logs ×
              recipe — deduct_ingredients() doesn&apos;t keep its own audit trail.
              &quot;Restocked&quot; is what was actually purchased/received in this period.
            </p>
            {data.ingredientUsage.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No ingredient activity in this period.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Ingredient</th>
                      <th className="pb-2 pr-3">Unit</th>
                      <th className="pb-2 pr-3">Deducted (theory)</th>
                      <th className="pb-2 pr-3">Restocked (actual)</th>
                      <th className="pb-2">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.ingredientUsage.map((row) => (
                      <tr key={row.ingredientId}>
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3">{row.unit}</td>
                        <td className="py-2 pr-3">{row.deducted.toFixed(2)}</td>
                        <td className="py-2 pr-3">{row.restocked.toFixed(2)}</td>
                        <td className="py-2">
                          {row.variance >= 0 ? "+" : ""}
                          {row.variance.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
