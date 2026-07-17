"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type ScheduleRow = {
  id: string;
  productId: string | null;
  productName: string;
  scheduledDate: string;
  qtyPlanned: number;
  startTime: string | null;
  completeBy: string | null;
  packagingTime: string | null;
  status: string;
  notes: string | null;
};

type CapacityRow = {
  id: string;
  day_of_week: number | null;
  specific_date: string | null;
  max_qty: number;
  notes: string | null;
};

type Product = { id: string; name: string };

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

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
  const minutes = time.split(":")[1];
  return `${h}:${minutes} ${period}`;
}

function formatStatus(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// 1=Monday...7=Sunday — matches production_capacity_config's seed data.
function isoDayOfWeek(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function resolveCapacity(dateISO: string, config: CapacityRow[]): number | null {
  const specific = config.find((c) => c.specific_date === dateISO);
  if (specific) return specific.max_qty;
  const byDow = config.find((c) => c.day_of_week === isoDayOfWeek(dateISO));
  return byDow?.max_qty ?? null;
}

export default function ProductionSchedulePage() {
  const router = useRouter();

  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [capacityConfig, setCapacityConfig] = useState<CapacityRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // New schedule modal
  const [showNewSchedule, setShowNewSchedule] = useState(false);
  const [formProductId, setFormProductId] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formStartTime, setFormStartTime] = useState("");
  const [formCompleteBy, setFormCompleteBy] = useState("");
  const [formPackagingTime, setFormPackagingTime] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);

  // Day-of-week capacity editing
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [editingMaxQty, setEditingMaxQty] = useState("");
  const [savingDayEdit, setSavingDayEdit] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  // Add date override
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideMaxQty, setOverrideMaxQty] = useState("");
  const [overrideNotes, setOverrideNotes] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);

  async function loadData() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/production/schedule");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();

    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load production schedule.");
    } else {
      setSchedules(json.schedules ?? []);
      setCapacityConfig(json.capacityConfig ?? []);
      setProducts(json.products ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const s of schedules) {
      if (!map.has(s.scheduledDate)) map.set(s.scheduledDate, []);
      map.get(s.scheduledDate)!.push(s);
    }
    return Array.from(map.entries());
  }, [schedules]);

  const dayOfWeekRows = capacityConfig
    .filter((c) => c.day_of_week !== null)
    .sort((a, b) => (a.day_of_week ?? 0) - (b.day_of_week ?? 0));
  const dateOverrideRows = capacityConfig
    .filter((c) => c.specific_date !== null)
    .sort((a, b) => (a.specific_date ?? "").localeCompare(b.specific_date ?? ""));

  // Live capacity warning for the New Schedule form.
  const formQtyNum = Number(formQty) || 0;
  const existingTotalForDate = formDate
    ? schedules
        .filter((s) => s.scheduledDate === formDate && s.status !== "cancelled")
        .reduce((sum, s) => sum + s.qtyPlanned, 0)
    : 0;
  const newTotalForDate = existingTotalForDate + formQtyNum;
  const capacityForDate = formDate ? resolveCapacity(formDate, capacityConfig) : null;
  const overCapacity =
    formDate && formQtyNum > 0 && capacityForDate !== null && newTotalForDate > capacityForDate;

  function resetScheduleForm() {
    setFormProductId("");
    setFormDate("");
    setFormQty("");
    setFormStartTime("");
    setFormCompleteBy("");
    setFormPackagingTime("");
    setFormNotes("");
    setScheduleFormError(null);
  }

  async function handleSaveSchedule() {
    setScheduleFormError(null);

    if (!formProductId || !formDate || formQtyNum <= 0) {
      setScheduleFormError("Flavour, date, and a valid quantity are required.");
      return;
    }

    setSavingSchedule(true);
    const res = await fetch("/api/admin/production/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: formProductId,
        scheduledDate: formDate,
        qtyPlanned: formQtyNum,
        startTime: formStartTime,
        completeBy: formCompleteBy,
        packagingTime: formPackagingTime,
        notes: formNotes,
      }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingSchedule(false);

    if (!res.ok) {
      setScheduleFormError(json.error ?? "Could not save schedule.");
      return;
    }

    resetScheduleForm();
    setShowNewSchedule(false);
    loadData();
  }

  function startEditingDay(row: CapacityRow) {
    setEditingDayId(row.id);
    setEditingMaxQty(String(row.max_qty));
    setCapacityError(null);
  }

  async function handleSaveDayEdit() {
    if (!editingDayId) return;
    const maxQty = Number(editingMaxQty);
    if (Number.isNaN(maxQty) || maxQty <= 0) {
      setCapacityError("Enter a valid max quantity.");
      return;
    }

    setSavingDayEdit(true);
    const res = await fetch(`/api/admin/production/capacity/${editingDayId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxQty }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingDayEdit(false);

    if (!res.ok) {
      setCapacityError(json.error ?? "Could not update capacity.");
      return;
    }

    setEditingDayId(null);
    loadData();
  }

  async function handleSaveOverride() {
    setCapacityError(null);

    if (!overrideDate || !overrideMaxQty) {
      setCapacityError("Date and max quantity are required.");
      return;
    }

    setSavingOverride(true);
    const res = await fetch("/api/admin/production/capacity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specificDate: overrideDate,
        maxQty: Number(overrideMaxQty),
        notes: overrideNotes,
      }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setSavingOverride(false);

    if (!res.ok) {
      setCapacityError(json.error ?? "Could not save override.");
      return;
    }

    setOverrideDate("");
    setOverrideMaxQty("");
    setOverrideNotes("");
    setShowOverrideForm(false);
    loadData();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Production Schedule</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowNewSchedule(true)}
        className="mt-6 min-h-11 rounded bg-gray-900 px-4 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      >
        New Production Schedule
      </button>

      {/* Upcoming schedules, grouped by date */}
      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Upcoming Schedule</h2>
        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : groupedByDate.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No upcoming production scheduled.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {groupedByDate.map(([date, rows]) => (
              <div key={date}>
                <h3 className="text-xs font-medium text-gray-500">
                  {formatShortDate(date)}
                </h3>
                <ul className="mt-1 space-y-2">
                  {rows.map((s) => (
                    <li
                      key={s.id}
                      className="rounded border border-gray-100 p-2 text-sm dark:border-gray-800"
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
                        {formatTimeLabel(s.completeBy)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Capacity settings */}
      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">Daily Capacity</h2>
        {capacityError && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {capacityError}
          </p>
        )}

        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {dayOfWeekRows.map((row) => (
              <tr key={row.id}>
                <td className="py-2">{WEEKDAY_NAMES[(row.day_of_week ?? 1) - 1]}</td>
                <td className="py-2">
                  {editingDayId === row.id ? (
                    <input
                      type="number"
                      value={editingMaxQty}
                      onChange={(e) => setEditingMaxQty(e.target.value)}
                      className="w-24 rounded border border-gray-300 px-2 py-1 text-base dark:border-gray-700 dark:bg-gray-900"
                    />
                  ) : (
                    `${row.max_qty} pcs`
                  )}
                </td>
                <td className="py-2 text-right">
                  {editingDayId === row.id ? (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingDayId(null)}
                        className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveDayEdit}
                        disabled={savingDayEdit}
                        className="min-h-11 rounded bg-gray-900 px-3 text-xs font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditingDay(row)}
                      className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {dateOverrideRows.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-gray-500">Date overrides</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {dateOverrideRows.map((row) => (
                <li key={row.id} className="flex justify-between gap-2">
                  <span>{formatShortDate(row.specific_date!)}</span>
                  <span>{row.max_qty} pcs</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showOverrideForm ? (
          <div className="mt-4 rounded border border-gray-200 p-3 dark:border-gray-700">
            <label className="text-xs font-medium text-gray-500" htmlFor="override-date">
              Date
            </label>
            <input
              id="override-date"
              type="date"
              min={todayISO()}
              value={overrideDate}
              onChange={(e) => setOverrideDate(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />
            <label
              className="mt-3 block text-xs font-medium text-gray-500"
              htmlFor="override-max-qty"
            >
              Max qty for this date
            </label>
            <input
              id="override-max-qty"
              type="number"
              value={overrideMaxQty}
              onChange={(e) => setOverrideMaxQty(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />
            <label
              className="mt-3 block text-xs font-medium text-gray-500"
              htmlFor="override-notes"
            >
              Notes (optional)
            </label>
            <input
              id="override-notes"
              type="text"
              value={overrideNotes}
              onChange={(e) => setOverrideNotes(e.target.value)}
              placeholder="e.g. large event"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setShowOverrideForm(false)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveOverride}
                disabled={savingOverride}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {savingOverride ? "Saving..." : "Save Override"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowOverrideForm(true)}
            className="mt-4 min-h-11 rounded border border-gray-300 px-3 text-sm dark:border-gray-700"
          >
            Add date override
          </button>
        )}
      </section>

      {/* New Production Schedule modal */}
      {showNewSchedule && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">New Production Schedule</h2>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="sched-product">
              Flavour
            </label>
            <select
              id="sched-product"
              value={formProductId}
              onChange={(e) => setFormProductId(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">Select a flavour</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="sched-date">
              Date
            </label>
            <input
              id="sched-date"
              type="date"
              min={todayISO()}
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="sched-qty">
              Qty to produce
            </label>
            <input
              id="sched-qty"
              type="number"
              min={1}
              value={formQty}
              onChange={(e) => setFormQty(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />
            {overCapacity && (
              <p className="mt-1 text-xs text-red-600">
                Adding {formQtyNum} pcs on {formatShortDate(formDate)} would bring total
                to {newTotalForDate} pcs, exceeding the {capacityForDate} pcs daily limit
              </p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500" htmlFor="sched-start">
                  Start
                </label>
                <input
                  id="sched-start"
                  type="time"
                  value={formStartTime}
                  onChange={(e) => setFormStartTime(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500" htmlFor="sched-complete">
                  Complete by
                </label>
                <input
                  id="sched-complete"
                  type="time"
                  value={formCompleteBy}
                  onChange={(e) => setFormCompleteBy(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500" htmlFor="sched-packaging">
                  Packaging
                </label>
                <input
                  id="sched-packaging"
                  type="time"
                  value={formPackagingTime}
                  onChange={(e) => setFormPackagingTime(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
            </div>

            <label className="mt-3 block text-xs font-medium text-gray-500" htmlFor="sched-notes">
              Notes (optional)
            </label>
            <textarea
              id="sched-notes"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            />

            {scheduleFormError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {scheduleFormError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  resetScheduleForm();
                  setShowNewSchedule(false);
                }}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSchedule}
                disabled={savingSchedule}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {savingSchedule ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
