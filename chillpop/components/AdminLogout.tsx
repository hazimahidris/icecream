"use client";

import { useRouter } from "next/navigation";

export function AdminLogout() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="text-sm text-gray-500 underline"
    >
      Logout
    </button>
  );
}
