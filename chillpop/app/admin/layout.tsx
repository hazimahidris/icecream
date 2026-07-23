"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LowStockBell } from "@/components/LowStockBell";
import { AdminNav } from "@/components/AdminNav";

const PUBLIC_PAGES = ["/admin/login", "/admin/reset-password"];

function DeniedBanner() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  if (searchParams.get("denied") !== "1" || dismissed) return null;

  return (
    <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <span>You do not have permission to access this page.</span>
        <button type="button" onClick={() => setDismissed(true)} className="ml-4 shrink-0 underline">
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicPage = PUBLIC_PAGES.includes(pathname);

  if (isPublicPage) {
    return <>{children}</>;
  }

  return (
    <>
      {/* No backdrop-blur here — that CSS property creates a new
          "containing block" for any position:fixed descendant, which
          clips AdminNav's fixed sidebar/drawer to this thin bar's
          height instead of the full viewport. */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white/95 px-4 py-2 dark:border-gray-800 dark:bg-gray-950/95">
        <AdminNav />
        <div className="flex-1" />
        <LowStockBell />
      </div>
      <div className="lg:pl-56">
        <Suspense fallback={null}>
          <DeniedBanner />
        </Suspense>
        {children}
      </div>
    </>
  );
}
