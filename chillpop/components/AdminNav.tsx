"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { isStaffAllowedPage } from "@/lib/staffAccess";

type NavLink = { label: string; href: string };
type NavGroup = { label: string; href?: string; items?: NavLink[] };

const NAV_GROUPS: NavGroup[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Orders", href: "/admin/orders" },
  { label: "Payments", href: "/admin/payments" },
  // Not in the requested list — kept so this real, already-built page
  // stays reachable. Remove if that was deliberate, not an oversight.
  { label: "Discounts", href: "/admin/discounts" },
  { label: "Booking Calendar", href: "/admin/calendar" },
  {
    label: "Production",
    items: [
      { label: "Today's Schedule", href: "/admin/production" },
      { label: "Production Planner", href: "/admin/production/schedule" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Finished Goods", href: "/admin/inventory/stock" },
      { label: "Ingredients", href: "/admin/inventory/ingredients" },
      { label: "Foam Box Tracker", href: "/admin/inventory/foam-boxes" },
    ],
  },
  {
    label: "Purchasing",
    items: [{ label: "Purchase Forecast", href: "/admin/purchasing/forecast" }],
  },
  {
    label: "POS",
    items: [{ label: "Point of Sale", href: "/admin/pos" }],
  },
  {
    label: "Products",
    items: [{ label: "Products & Recipes", href: "/admin/products" }],
  },
  {
    label: "Reports",
    items: [
      { label: "Sales", href: "/admin/reports/sales" },
      { label: "Financial", href: "/admin/reports/financial" },
      { label: "Inventory", href: "/admin/reports/inventory" },
      { label: "Operational", href: "/admin/reports/operational" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Deposit Tiers", href: "/admin/settings/deposit-tiers" },
      { label: "Staff", href: "/admin/settings/staff" },
    ],
  },
];

function visibleGroups(role: "admin" | "staff" | null): NavGroup[] {
  if (role === "admin") return NAV_GROUPS;
  if (role !== "staff") return [];

  return NAV_GROUPS.map((g) => {
    if (g.href) return isStaffAllowedPage(g.href) ? g : null;
    const items = (g.items ?? []).filter((i) => isStaffAllowedPage(i.href));
    return items.length > 0 ? { ...g, items } : null;
  }).filter((g): g is NavGroup => g !== null);
}

export function AdminNav() {
  const pathname = usePathname();
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      const {
        data: { user },
        error: userError,
      } = await supabaseBrowser.auth.getUser();

      if (userError) {
        if (!cancelled) setLoadError(userError.message);
        return;
      }
      if (!user) {
        if (!cancelled) setLoadError("No signed-in user found.");
        return;
      }

      const { data, error } = await supabaseBrowser
        .from("staff_users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setLoadError(error?.message ?? "No staff_users row found for this account.");
        return;
      }

      setRole(data.role as "admin" | "staff");
    }

    loadRole();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const groups = visibleGroups(role);

  function renderLink(label: string, href: string) {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={`block rounded px-2 py-2 text-sm ${
          active
            ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        }`}
      >
        {label}
      </Link>
    );
  }

  const content = loadError ? (
    <p className="px-2 text-xs text-red-600 dark:text-red-400">
      Couldn&apos;t load the menu: {loadError}
    </p>
  ) : role === null ? (
    <p className="px-2 text-xs text-gray-400">Loading menu...</p>
  ) : (
    <nav className="space-y-4">
      {groups.map((g) =>
        g.href ? (
          <div key={g.label}>{renderLink(g.label, g.href)}</div>
        ) : (
          <div key={g.label}>
            <p className="px-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              {g.label}
            </p>
            <div className="mt-1 space-y-0.5">
              {g.items!.map((item) => renderLink(item.label, item.href))}
            </div>
          </div>
        )
      )}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="flex min-h-11 min-w-11 items-center justify-center rounded border border-gray-300 text-lg lg:hidden dark:border-gray-700"
      >
        ☰
      </button>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 overflow-y-auto border-r border-gray-200 bg-white p-4 pt-16 lg:block dark:border-gray-800 dark:bg-gray-950">
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-64 overflow-y-auto bg-white p-4 dark:bg-gray-950">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Menu</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="flex min-h-11 min-w-11 items-center justify-center text-lg"
              >
                ✕
              </button>
            </div>
            <div className="mt-4">{content}</div>
          </div>
        </div>
      )}
    </>
  );
}
