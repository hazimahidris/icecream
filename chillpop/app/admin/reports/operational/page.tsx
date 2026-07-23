"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type PipelineEntry = {
  date: string;
  totalOrders: number;
  totalValueOutstanding: number;
  flavours: { name: string; qty: number }[];
};

type LateOrCancelledRow = {
  orderId: string;
  orderNumber: number | null;
  customerName: string | null;
  fulfilmentDate: string;
  reason: string;
};

type FulfilmentRate = {
  onTimeCount: number;
  lateCount: number;
  earlyCount: number;
  cancelledCount: number;
  excludedNoTimestamp: number;
  onTimeRatePct: number | null;
  lateOrCancelledList: LateOrCancelledRow[];
};

type TopCustomer = {
  customerId: string;
  name: string | null;
  phone: string | null;
  orderCount: number;
  totalValue: number;
};

type CustomerHistory = {
  topCustomers: TopCustomer[];
  repeatCustomerRatePct: number;
  totalDistinctCustomers: number;
};

type ProductionEfficiencyRow = {
  productId: string;
  name: string;
  weekStart: string;
  planned: number;
  actual: number;
  variance: number;
};

type ReportData = {
  range: { start: string; end: string };
  upcomingPipeline: PipelineEntry[];
  fulfilmentRate: FulfilmentRate;
  customerHistory: CustomerHistory;
  productionEfficiency: ProductionEfficiencyRow[];
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
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

export default function OperationalReportPage() {
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

    const res = await fetch(`/api/admin/reports/operational?start=${start}&end=${end}`);

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
        <h1 className="text-2xl font-semibold">Operational Report</h1>
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
            className="min-h-11 rounded border border-gray-300 px-2 dark:border-gray-700 dark:bg-gray-900"
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </div>
      )}

      {loading || !data ? (
        <p className="mt-6 text-sm text-gray-500">Loading...</p>
      ) : (
        <>
          {/* Section 1 */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Upcoming Bookings Pipeline</h2>
            <p className="mt-1 text-xs text-gray-500">
              All current Booking Confirmed / Preparing orders — a live pipeline view, not
              limited to the selected period.
            </p>
            {data.upcomingPipeline.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No upcoming bookings.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {data.upcomingPipeline.map((entry) => (
                  <div
                    key={entry.date}
                    className="rounded border border-gray-200 p-3 text-sm dark:border-gray-700"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{formatDate(entry.date)}</span>
                      <span className="text-xs text-gray-500">
                        {entry.totalOrders} order{entry.totalOrders === 1 ? "" : "s"} ·{" "}
                        {formatMoney(entry.totalValueOutstanding)} outstanding
                      </span>
                    </div>
                    <ul className="mt-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                      {entry.flavours.map((f) => (
                        <li key={f.name}>
                          {f.name}: {f.qty} pcs
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Section 2 */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Fulfilment Rate</h2>
            <p className="mt-1 text-xs text-gray-500">
              Scoped to orders whose fulfilment date falls in the selected period.
              &quot;On time&quot; means the delivered date exactly matched the promised
              fulfilment date.
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-xs text-gray-500">On-Time Rate</p>
                <p className="text-xl font-semibold">
                  {data.fulfilmentRate.onTimeRatePct === null
                    ? "-"
                    : `${data.fulfilmentRate.onTimeRatePct.toFixed(1)}%`}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-xs text-gray-500">On Time / Early / Late</p>
                <p className="text-sm font-medium">
                  {data.fulfilmentRate.onTimeCount} / {data.fulfilmentRate.earlyCount} /{" "}
                  {data.fulfilmentRate.lateCount}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-xs text-gray-500">Cancelled</p>
                <p className="text-xl font-semibold">{data.fulfilmentRate.cancelledCount}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-xs text-gray-500">Excluded (no timestamp)</p>
                <p className="text-xl font-semibold">{data.fulfilmentRate.excludedNoTimestamp}</p>
              </div>
            </div>
            {data.fulfilmentRate.excludedNoTimestamp > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                These were delivered before delivery timestamps started being recorded, so
                on-time status is unknown for them.
              </p>
            )}

            <h3 className="mt-4 text-xs font-medium text-gray-500">Late or Cancelled Orders</h3>
            {data.fulfilmentRate.lateOrCancelledList.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">None in this period.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Order ID</th>
                      <th className="pb-2 pr-3">Customer</th>
                      <th className="pb-2 pr-3">Fulfilment Date</th>
                      <th className="pb-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.fulfilmentRate.lateOrCancelledList.map((row) => (
                      <tr key={row.orderId}>
                        <td className="py-2 pr-3">
                          {row.orderNumber ? `#${row.orderNumber}` : "-"}
                        </td>
                        <td className="py-2 pr-3">{row.customerName ?? "-"}</td>
                        <td className="py-2 pr-3">{formatDate(row.fulfilmentDate)}</td>
                        <td className="py-2">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 3 */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Customer Purchase History</h2>
              <p className="text-xs text-gray-500">
                Repeat customer rate: {data.customerHistory.repeatCustomerRatePct.toFixed(1)}% (
                {data.customerHistory.totalDistinctCustomers} distinct customers)
              </p>
            </div>
            {data.customerHistory.topCustomers.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No customer orders in this period.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Customer</th>
                      <th className="pb-2 pr-3">Orders</th>
                      <th className="pb-2">Total Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.customerHistory.topCustomers.map((c) => (
                      <tr key={c.customerId}>
                        <td className="py-2 pr-3">
                          {c.name ?? "-"}
                          {c.phone && (
                            <span className="block text-xs text-gray-500">{c.phone}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{c.orderCount}</td>
                        <td className="py-2">{formatMoney(c.totalValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 4 */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Production Efficiency</h2>
            <p className="mt-1 text-xs text-gray-500">Planned vs actual, per flavour per week.</p>
            {data.productionEfficiency.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No production activity in this period.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Week Of</th>
                      <th className="pb-2 pr-3">Flavour</th>
                      <th className="pb-2 pr-3">Planned</th>
                      <th className="pb-2 pr-3">Actual</th>
                      <th className="pb-2">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.productionEfficiency.map((row) => (
                      <tr key={`${row.productId}-${row.weekStart}`}>
                        <td className="py-2 pr-3">{formatDate(row.weekStart)}</td>
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3">{row.planned}</td>
                        <td className="py-2 pr-3">{row.actual}</td>
                        <td className="py-2">
                          {row.variance >= 0 ? "+" : ""}
                          {row.variance}
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
