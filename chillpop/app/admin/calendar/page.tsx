"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type ViewMode = "day" | "week" | "month";

type CapacityConfigRow = {
  day_of_week: number | null;
  specific_date: string | null;
  max_qty: number;
};

type DayOrder = {
  orderId: string;
  orderNumber: number | null;
  customerName: string | null;
  fulfilmentType: string | null;
  fulfilmentTime: string | null;
  flavours: { name: string; qty: number }[];
};

type FlavourTotal = { name: string; qty: number };
type FlavourStock = { productId: string; name: string; available: number | null };

type DayData = {
  orders: DayOrder[];
  flavourTotals: FlavourTotal[];
  stockByFlavour: FlavourStock[];
};

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatShortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]}`;
}

function formatTimeLabel(time: string | null) {
  if (!time) return "-";
  let h = Number(time.split(":")[0]);
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:00 ${period}`;
}

function formatOrderCode(orderNumber: number | null) {
  return orderNumber ? `ORD-${String(orderNumber).padStart(4, "0")}` : "-";
}

// All date math below works on ISO "yyyy-MM-dd" strings via UTC
// components — avoids local-timezone drift bugs entirely.
function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 1=Monday...7=Sunday — matches production_capacity_config's seed data
// convention, NOT JS's native Date.getUTCDay() (0=Sunday...6=Saturday).
function isoDayOfWeek(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function getWeekStart(dateISO: string): string {
  return addDaysISO(dateISO, -(isoDayOfWeek(dateISO) - 1));
}

function getMonthGrid(year: number, month: number): (string | null)[] {
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const leadingBlanks = isoDayOfWeek(firstOfMonth) - 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function getCapacity(dateISO: string, config: CapacityConfigRow[]): number | null {
  const specific = config.find((c) => c.specific_date === dateISO);
  if (specific) return specific.max_qty;
  const dow = isoDayOfWeek(dateISO);
  const byDow = config.find((c) => c.day_of_week === dow);
  return byDow?.max_qty ?? null;
}

// Stock-level colour coding for the day view. Thresholds aren't
// specified in the spec beyond "0 = red" — 10 pcs is an assumed
// low-stock cutoff, adjust here if you want a different number.
function stockColour(available: number | null) {
  if (available === null) return "text-gray-400";
  if (available === 0) return "text-red-600";
  if (available < 10) return "text-amber-600";
  return "text-green-600";
}

export default function AdminCalendarPage() {
  const router = useRouter();

  const [view, setView] = useState<ViewMode>("month");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [monthAnchor, setMonthAnchor] = useState(todayISO());

  const [dailyTotals, setDailyTotals] = useState<Record<string, number>>({});
  const [capacityConfig, setCapacityConfig] = useState<CapacityConfigRow[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [dayData, setDayData] = useState<DayData | null>(null);
  const [loadingDay, setLoadingDay] = useState(true);
  const [dayError, setDayError] = useState<string | null>(null);

  const summaryRange = useMemo(() => {
    if (view === "month") {
      const [y, m] = monthAnchor.split("-").map(Number);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
      return { start, end };
    }
    if (view === "week") {
      const start = getWeekStart(selectedDate);
      const end = addDaysISO(start, 6);
      return { start, end };
    }
    return null;
  }, [view, monthAnchor, selectedDate]);

  useEffect(() => {
    if (!summaryRange) return;

    async function loadSummary() {
      setLoadingSummary(true);
      setSummaryError(null);

      const res = await fetch(
        `/api/admin/calendar/summary?start=${summaryRange!.start}&end=${summaryRange!.end}`
      );

      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }

      const json = await res.json();
      if (!res.ok) {
        setSummaryError(json.error ?? "Failed to load calendar.");
      } else {
        setDailyTotals(json.dailyTotals ?? {});
        setCapacityConfig(json.capacityConfig ?? []);
      }
      setLoadingSummary(false);
    }

    loadSummary();
  }, [summaryRange, router]);

  useEffect(() => {
    if (view !== "day") return;

    async function loadDay() {
      setLoadingDay(true);
      setDayError(null);

      const res = await fetch(`/api/admin/calendar/day?date=${selectedDate}`);

      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }

      const json = await res.json();
      if (!res.ok) {
        setDayError(json.error ?? "Failed to load day.");
      } else {
        setDayData(json);
      }
      setLoadingDay(false);
    }

    loadDay();
  }, [view, selectedDate, router]);

  function goToDay(date: string) {
    setSelectedDate(date);
    setView("day");
  }

  const [monthYear, monthNum] = monthAnchor.split("-").map(Number);
  const monthGrid = getMonthGrid(monthYear, monthNum);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysISO(getWeekStart(selectedDate), i));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Booking Calendar</h1>
        <AdminLogout />
      </div>

      <div className="mt-6 flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {(["day", "week", "month"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setView(mode)}
            className={`min-h-11 px-4 text-sm font-medium capitalize ${
              view === mode
                ? "border-b-2 border-gray-900 dark:border-gray-100"
                : "text-gray-500"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Month view */}
      {view === "month" && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthAnchor(addDaysISO(`${monthAnchor}-01`, -1).slice(0, 7))}
              className="min-h-11 rounded border border-gray-300 px-3 text-sm dark:border-gray-700"
            >
              ← Prev
            </button>
            <p className="text-sm font-medium">
              {MONTH_ABBR[monthNum - 1]} {monthYear}
            </p>
            <button
              type="button"
              onClick={() =>
                setMonthAnchor(addDaysISO(`${monthAnchor}-01`, 32).slice(0, 7))
              }
              className="min-h-11 rounded border border-gray-300 px-3 text-sm dark:border-gray-700"
            >
              Next →
            </button>
          </div>

          {summaryError && (
            <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {summaryError}
            </p>
          )}

          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-gray-500">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {loadingSummary
              ? Array.from({ length: 35 }, (_, i) => (
                  <div key={i} className="h-16 rounded border border-gray-100 dark:border-gray-800" />
                ))
              : monthGrid.map((date, i) => {
                  if (!date) return <div key={i} />;

                  const total = dailyTotals[date] ?? 0;
                  const capacity = getCapacity(date, capacityConfig);
                  const isOverHalf = capacity !== null && total > capacity * 0.5;

                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => goToDay(date)}
                      className="flex h-16 flex-col items-center justify-center rounded border border-gray-200 text-xs hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500"
                    >
                      <span className="text-gray-500">{Number(date.slice(8, 10))}</span>
                      {total > 0 && (
                        <span className={isOverHalf ? "text-[coral] font-medium" : ""}>
                          {total} pcs
                        </span>
                      )}
                    </button>
                  );
                })}
          </div>
        </div>
      )}

      {/* Week view */}
      {view === "week" && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setSelectedDate(addDaysISO(selectedDate, -7))}
              className="min-h-11 rounded border border-gray-300 px-3 text-sm dark:border-gray-700"
            >
              ← Prev week
            </button>
            <p className="text-sm font-medium">
              {formatShortDate(weekDates[0])} – {formatShortDate(weekDates[6])}
            </p>
            <button
              type="button"
              onClick={() => setSelectedDate(addDaysISO(selectedDate, 7))}
              className="min-h-11 rounded border border-gray-300 px-3 text-sm dark:border-gray-700"
            >
              Next week →
            </button>
          </div>

          {summaryError && (
            <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {summaryError}
            </p>
          )}

          <div className="mt-4 grid grid-cols-7 gap-2">
            {weekDates.map((date) => {
              const total = dailyTotals[date] ?? 0;
              const capacity = getCapacity(date, capacityConfig);
              const isOverHalf = capacity !== null && total > capacity * 0.5;

              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => goToDay(date)}
                  className="flex flex-col items-center gap-1 rounded border border-gray-200 p-3 text-center hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500"
                >
                  <span className="text-xs text-gray-500">
                    {WEEKDAY_LABELS[isoDayOfWeek(date) - 1]}
                  </span>
                  <span className="text-xs text-gray-500">{formatShortDate(date)}</span>
                  <span
                    className={`text-sm font-medium ${isOverHalf ? "text-[coral]" : ""}`}
                  >
                    {loadingSummary ? "-" : `${total} pcs`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Day view */}
      {view === "day" && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setSelectedDate(addDaysISO(selectedDate, -1))}
              className="min-h-11 rounded border border-gray-300 px-3 text-sm dark:border-gray-700"
            >
              ← Prev day
            </button>
            <p className="text-sm font-medium">{formatShortDate(selectedDate)}</p>
            <button
              type="button"
              onClick={() => setSelectedDate(addDaysISO(selectedDate, 1))}
              className="min-h-11 rounded border border-gray-300 px-3 text-sm dark:border-gray-700"
            >
              Next day →
            </button>
          </div>

          {dayError && (
            <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {dayError}
            </p>
          )}

          {loadingDay ? (
            <p className="mt-6 text-sm text-gray-500">Loading...</p>
          ) : (
            <>
              <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <h2 className="text-sm font-medium">Reservations</h2>
                {!dayData || dayData.orders.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-500">No reservations for this date.</p>
                ) : (
                  <ul className="mt-3 space-y-3 text-sm">
                    {dayData.orders.map((order) => (
                      <li
                        key={order.orderId}
                        className="rounded border border-gray-100 p-3 dark:border-gray-800"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {formatOrderCode(order.orderNumber)}
                          </span>
                          <span className="text-xs text-gray-500 capitalize">
                            {order.fulfilmentType ?? "-"} · {formatTimeLabel(order.fulfilmentTime)}
                          </span>
                        </div>
                        <p className="mt-1 text-gray-600 dark:text-gray-400">
                          {order.customerName ?? "-"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {order.flavours.map((f) => `${f.name} x${f.qty}`).join(", ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <h2 className="text-sm font-medium">Total pcs per flavour</h2>
                {!dayData || dayData.flavourTotals.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-500">Nothing reserved.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {dayData.flavourTotals.map((f) => (
                      <li key={f.name} className="flex justify-between gap-2">
                        <span className="min-w-0 break-words">{f.name}</span>
                        <span className="shrink-0">{f.qty} pcs</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <h2 className="text-sm font-medium">Available stock this date</h2>
                {!dayData || dayData.stockByFlavour.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-500">No active products.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {dayData.stockByFlavour.map((f) => (
                      <li key={f.productId} className="flex justify-between gap-2">
                        <span className="min-w-0 break-words">{f.name}</span>
                        <span className={`shrink-0 font-medium ${stockColour(f.available)}`}>
                          {f.available === null ? "-" : `${f.available} pcs`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
