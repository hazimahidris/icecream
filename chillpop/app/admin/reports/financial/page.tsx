"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type ProfitRow = {
  productId: string;
  name: string;
  qtySold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  grossMarginPct: number;
  isLowMargin: boolean;
};

type OutstandingPayment = {
  orderId: string;
  orderNumber: number | null;
  customerName: string | null;
  customerPhone: string | null;
  fulfilmentDate: string;
  total: number;
  depositPaid: number;
  balanceDue: number;
};

type ActiveRental = {
  id: string;
  orderNumber: number | null;
  customerName: string | null;
  qty: number;
  depositPaid: number;
  depositRefunded: number;
  status: string;
};

type FinancialReport = {
  range: { start: string; end: string };
  profitByFlavour: ProfitRow[];
  lowMarginThreshold: number;
  revenueSummary: { grossRevenue: number; estimatedCost: number; estimatedGrossProfit: number };
  outstandingPayments: OutstandingPayment[];
  foamBoxLedger: {
    totalDeposits: number;
    totalRefunded: number;
    netHeld: number;
    activeRentals: ActiveRental[];
  };
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

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

export default function FinancialReportPage() {
  const router = useRouter();

  const [rangeType, setRangeType] = useState<RangeType>("month");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  const { start, end } = useMemo(
    () => computeRange(rangeType, customStart, customEnd),
    [rangeType, customStart, customEnd]
  );

  const [data, setData] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const res = await fetch(`/api/admin/reports/financial?start=${start}&end=${end}`);

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
        <h1 className="text-2xl font-semibold">Financial Report</h1>
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
          {/* Section 4 — revenue summary */}
          <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500">Gross Revenue</p>
              <p className="text-2xl font-semibold">
                {formatMoney(data.revenueSummary.grossRevenue)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500">Estimated Cost</p>
              <p className="text-2xl font-semibold">
                {formatMoney(data.revenueSummary.estimatedCost)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <p className="text-xs text-gray-500">Estimated Gross Profit</p>
              <p className="text-2xl font-semibold">
                {formatMoney(data.revenueSummary.estimatedGrossProfit)}
              </p>
            </div>
          </section>
          <p className="mt-2 text-xs text-gray-500">
            Cost figures are estimates based on recipe costing. Actual costs may vary — update
            ingredient cost_per_unit regularly for accuracy.
          </p>

          {/* Section 1 — profit by flavour */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Profit by Flavour</h2>
            {data.profitByFlavour.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No fulfilled orders in this period.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Flavour</th>
                      <th className="pb-2 pr-3">Qty Sold</th>
                      <th className="pb-2 pr-3">Revenue</th>
                      <th className="pb-2 pr-3">Cost</th>
                      <th className="pb-2 pr-3">Gross Profit</th>
                      <th className="pb-2">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.profitByFlavour.map((row) => (
                      <tr
                        key={row.productId}
                        className={
                          row.isLowMargin
                            ? "bg-amber-50 dark:bg-amber-950/40"
                            : undefined
                        }
                      >
                        <td className="py-2 pr-3">{row.name}</td>
                        <td className="py-2 pr-3">{row.qtySold}</td>
                        <td className="py-2 pr-3">{formatMoney(row.revenue)}</td>
                        <td className="py-2 pr-3">{formatMoney(row.cost)}</td>
                        <td className="py-2 pr-3">{formatMoney(row.grossProfit)}</td>
                        <td
                          className={`py-2 font-medium ${
                            row.isLowMargin ? "text-amber-700 dark:text-amber-400" : ""
                          }`}
                        >
                          {row.grossMarginPct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-gray-500">
                  Amber rows are below {data.lowMarginThreshold}% gross margin.
                </p>
              </div>
            )}
          </section>

          {/* Section 2 — outstanding payments */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Outstanding Payments</h2>
            <p className="mt-1 text-xs text-gray-500">
              Money still owed — collect before or at pickup. Not limited to the selected period.
            </p>
            {data.outstandingPayments.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No outstanding balances.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Order ID</th>
                      <th className="pb-2 pr-3">Customer</th>
                      <th className="pb-2 pr-3">Fulfilment Date</th>
                      <th className="pb-2 pr-3">Total</th>
                      <th className="pb-2 pr-3">Deposit Paid</th>
                      <th className="pb-2">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.outstandingPayments.map((row) => (
                      <tr key={row.orderId}>
                        <td className="py-2 pr-3">
                          {row.orderNumber ? `#${row.orderNumber}` : "-"}
                        </td>
                        <td className="py-2 pr-3">
                          {row.customerName ?? "-"}
                          {row.customerPhone && (
                            <span className="block text-xs text-gray-500">
                              {row.customerPhone}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{formatDate(row.fulfilmentDate)}</td>
                        <td className="py-2 pr-3">{formatMoney(row.total)}</td>
                        <td className="py-2 pr-3">{formatMoney(row.depositPaid)}</td>
                        <td className="py-2 font-medium">{formatMoney(row.balanceDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 3 — foam box deposit ledger */}
          <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-sm font-medium">Foam Box Deposit Ledger</h2>
            <p className="mt-1 text-xs text-gray-500">All-time totals, not limited to the selected period.</p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <p className="text-xs text-gray-500">Total Deposits Collected</p>
                <p className="text-xl font-semibold">
                  {formatMoney(data.foamBoxLedger.totalDeposits)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <p className="text-xs text-gray-500">Total Deposits Refunded</p>
                <p className="text-xl font-semibold">
                  {formatMoney(data.foamBoxLedger.totalRefunded)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <p className="text-xs text-gray-500">Net Deposits Held</p>
                <p className="text-xl font-semibold">{formatMoney(data.foamBoxLedger.netHeld)}</p>
              </div>
            </div>

            <h3 className="mt-4 text-xs font-medium text-gray-500">Active Rentals</h3>
            {data.foamBoxLedger.activeRentals.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No active rentals.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2 pr-3">Order ID</th>
                      <th className="pb-2 pr-3">Customer</th>
                      <th className="pb-2 pr-3">Qty</th>
                      <th className="pb-2 pr-3">Deposit Paid</th>
                      <th className="pb-2 pr-3">Deposit Refunded</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.foamBoxLedger.activeRentals.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-3">
                          {row.orderNumber ? `#${row.orderNumber}` : "-"}
                        </td>
                        <td className="py-2 pr-3">{row.customerName ?? "-"}</td>
                        <td className="py-2 pr-3">{row.qty}</td>
                        <td className="py-2 pr-3">{formatMoney(row.depositPaid)}</td>
                        <td className="py-2 pr-3">{formatMoney(row.depositRefunded)}</td>
                        <td className="py-2 capitalize">{row.status.replace("_", " ")}</td>
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
