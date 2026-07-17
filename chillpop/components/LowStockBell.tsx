"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type IngredientAlert = {
  id: string;
  name: string;
  unit: string;
  qtyOnHand: number;
  threshold: number;
  percentRemaining: number;
};

type ProductAlert = {
  id: string;
  name: string;
  qtyOnHand: number;
};

export function LowStockBell() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [ingredientAlerts, setIngredientAlerts] = useState<IngredientAlert[]>([]);
  const [productAlerts, setProductAlerts] = useState<ProductAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  const loadAlerts = useCallback(async () => {
    const res = await fetch("/api/admin/alerts/low-stock");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
      setError(json?.error ?? "Failed to load alerts.");
      setLoading(false);
      return;
    }

    setError(null);
    setIngredientAlerts(json.ingredientAlerts ?? []);
    setProductAlerts(json.productAlerts ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadAlerts();

    const interval = setInterval(loadAlerts, REFRESH_INTERVAL_MS);

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        loadAlerts();
      }
    }
    window.addEventListener("focus", loadAlerts);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", loadAlerts);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadAlerts]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const totalCount = ingredientAlerts.length + productAlerts.length;

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Low stock alerts"
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full border border-gray-300 text-lg dark:border-gray-700"
      >
        🔔
        {totalCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-medium text-white">
            {totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <h3 className="text-sm font-medium">Low Stock Alerts</h3>

          {error && (
            <p className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
              {error}
            </p>
          )}

          {loading ? (
            <p className="mt-2 text-xs text-gray-500">Loading...</p>
          ) : totalCount === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No low-stock alerts.</p>
          ) : (
            <div className="mt-2 max-h-80 space-y-3 overflow-y-auto">
              {ingredientAlerts.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500">Ingredients</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {ingredientAlerts.map((i) => (
                      <li key={i.id}>
                        {i.name} — {i.qtyOnHand} {i.unit} remaining (threshold: {i.threshold})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {productAlerts.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500">Finished Goods</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {productAlerts.map((p) => (
                      <li key={p.id}>
                        {p.name} — {p.qtyOnHand} pcs on hand
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-col gap-1 border-t border-gray-100 pt-3 text-xs dark:border-gray-800">
            <Link
              href="/admin/inventory/ingredients"
              onClick={() => setOpen(false)}
              className="underline"
            >
              View ingredient inventory
            </Link>
            <Link
              href="/admin/inventory/stock"
              onClick={() => setOpen(false)}
              className="underline"
            >
              View finished goods stock
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
