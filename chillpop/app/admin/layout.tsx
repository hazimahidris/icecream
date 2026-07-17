"use client";

import { usePathname } from "next/navigation";
import { LowStockBell } from "@/components/LowStockBell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/admin/login";

  return (
    <>
      {!isLoginPage && (
        <div className="sticky top-0 z-30 flex justify-end border-b border-gray-200 bg-white/80 px-6 py-2 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
          <LowStockBell />
        </div>
      )}
      {children}
    </>
  );
}
