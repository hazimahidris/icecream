"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { AdminLogout } from "@/components/AdminLogout";

type Summary = {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  online: { count: number; revenue: number };
  pos: { count: number; revenue: number };
};

type FlavourRow = {
  productId: string;
  name: string;
  totalPcs: number;
  revenue: number;
};

type DailyRevenue = { date: string; revenue: number };

type ReportData = {
  range: { start: string; end: string };
  summary: Summary;
  flavourBreakdown: FlavourRow[];
  dailyRevenue: DailyRevenue[];
  bestSeller: FlavourRow | null;
  pendingVerification: { count: number; total: number };
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
  const day = d.getUTCDay(); // 0=Sun..6=Sat
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
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
  });
}

function DailyRevenueChart({ data }: { data: DailyRevenue[] }) {
  const width = 600;
  const height = 180;
  const padding = 24;

  const max = Math.max(1, ...data.map((d) => d.revenue));
  const step = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padding + i * step;
    const y = height - padding - (d.revenue / max) * (height - padding * 2);
    return { x, y, d };
  });

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-3 w-full"
      role="img"
      aria-label="Daily revenue chart"
    >
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        className="stroke-gray-200 dark:stroke-gray-700"
      />
      {points.length > 1 && (
        <polyline
          points={polylinePoints}
          fill="none"
          className="stroke-gray-900 dark:stroke-gray-100"
          strokeWidth={2}
        />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} className="fill-gray-900 dark:fill-gray-100" />
      ))}
      {points.length > 0 && (
        <>
          <text x={points[0].x} y={height - 6} fontSize={10} className="fill-gray-500">
            {formatDate(points[0].d.date)}
          </text>
          <text
            x={points[points.length - 1].x}
            y={height - 6}
            fontSize={10}
            textAnchor="end"
            className="fill-gray-500"
          >
            {formatDate(points[points.length - 1].d.date)}
          </text>
        </>
      )}
    </svg>
  );
}

export default function SalesReportPage() {
  const router = useRouter();

  const [rangeType, setRangeType] = useState<RangeType>("today");
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

    const res = await fetch(`/api/admin/reports/sales?start=${start}&end=${end}`);

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

  function handleExportCsv() {
    if (!data) return;

    const csv = Papa.unparse(
      data.flavourBreakdown.map((row) => ({
        Flavour: row.name,
        "Pcs Sold": row.totalPcs,
        "Revenue (RM)": row.revenue.toFixed(2),
      }))
    );

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-by-flavour_${start}_to_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const maxFlavourRevenue = Math.max(1, ...(data?.flavourBreakdown.map((r) => r.revenue) ?? [0]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sales Report</h1>
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
          {data.bestSeller && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Best-Selling Flavour ({formatDate(start)} – {formatDate(end)})
              </p>
              <p className="mt-1 text-xl font-semibold">{data.bestSeller.name}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {data.bestSeller.totalPcs} pcs — {formatMoney(data.bestSeller.revenue)} revenue
              </p>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500">Total Revenue</p>
              <p className="text-2xl font-semibold">{formatMoney(data.summary.totalRevenue)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500">Total Orders</p>
              <p className="text-2xl font-semibold">{data.summary.totalOrders}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500">Avg Order Value</p>
              <p className="text-2xl font-semibold">{formatMoney(data.summary.avgOrderValue)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500">Online vs POS</p>
              <p className="text-sm font-medium">
                Online: {data.summary.online.count} ({formatMoney(data.summary.online.revenue)})
              </p>
              <p className="text-sm font-medium">
                POS: {data.summary.pos.count} ({formatMoney(data.summary.pos.revenue)})
              </p>
            </div>
          </div>

          {data.pendingVerification.count > 0 && (
            <p className="mt-3 rounded border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
              Revenue figures include only verified and confirmed orders. {data.pendingVerification.count}{" "}
              order{data.pendingVerification.count === 1 ? "" : "s"} totalling{" "}
              {formatMoney(data.pendingVerification.total)} {data.pendingVerification.count === 1 ? "is" : "are"}{" "}
              awaiting payment verification and not included above.
            </p>
          )}

          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Daily Revenue</h2>
            {data.dailyRevenue.every((d) => d.revenue === 0) ? (
              <p className="mt-2 text-sm text-gray-500">No revenue in this period.</p>
            ) : (
              <DailyRevenueChart data={data.dailyRevenue} />
            )}
          </section>

          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Revenue by Flavour</h2>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={data.flavourBreakdown.length === 0}
                className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
              >
                Export CSV
              </button>
            </div>

            {data.flavourBreakdown.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No sales in this period.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Flavour</th>
                      <th className="pb-2 pr-3">Pcs Sold</th>
                      <th className="pb-2 pr-3">Revenue</th>
                      <th className="pb-2">Relative Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.flavourBreakdown.map((row) => (
                      <tr key={row.productId}>
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3">{row.totalPcs}</td>
                        <td className="py-2 pr-3">{formatMoney(row.revenue)}</td>
                        <td className="py-2">
                          <div className="h-2 w-full rounded bg-gray-100 dark:bg-gray-800">
                            <div
                              className="h-2 rounded bg-gray-900 dark:bg-gray-100"
                              style={{
                                width: `${(row.revenue / maxFlavourRevenue) * 100}%`,
                              }}
                            />
                          </div>
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
