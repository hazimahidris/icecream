"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type StaffMember = {
  id: string;
  name: string;
  email: string | null;
  role: "admin" | "staff";
  isActive: boolean;
  createdAt: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-MY", { dateStyle: "medium" });
}

export default function StaffSettingsPage() {
  const router = useRouter();

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "staff">("staff");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function loadStaff() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/settings/staff");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }
    if (res.status === 403) {
      router.push("/admin/pos?denied=1");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load staff.");
    } else {
      setStaff(json.staff ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleActive(member: StaffMember) {
    setActionError(null);
    setBusyId(member.id);

    const res = await fetch(`/api/admin/settings/staff/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !member.isActive }),
    });

    const json = await res.json();
    setBusyId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Could not update staff member.");
      return;
    }
    loadStaff();
  }

  async function handleChangeRole(member: StaffMember, role: "admin" | "staff") {
    if (role === member.role) return;
    setActionError(null);
    setBusyId(member.id);

    const res = await fetch(`/api/admin/settings/staff/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });

    const json = await res.json();
    setBusyId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Could not update staff member.");
      return;
    }
    loadStaff();
  }

  function openAddModal() {
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewRole("staff");
    setCreateError(null);
    setShowAddModal(true);
  }

  async function handleCreate() {
    setCreateError(null);
    setCreating(true);

    const res = await fetch("/api/admin/settings/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
      }),
    });

    const json = await res.json();
    setCreating(false);

    if (!res.ok) {
      setCreateError(json.error ?? "Could not create staff member.");
      return;
    }

    setShowAddModal(false);
    loadStaff();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}
      {actionError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <button
        type="button"
        onClick={openAddModal}
        className="mt-6 min-h-11 rounded bg-gray-900 px-4 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      >
        Add Staff Member
      </button>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">All Staff</h2>

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : staff.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No staff members yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Email</th>
                  <th className="pb-2 pr-3">Role</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Created</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-3">{s.name}</td>
                    <td className="py-2 pr-3">{s.email ?? "-"}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={s.role}
                        onChange={(e) =>
                          handleChangeRole(s, e.target.value as "admin" | "staff")
                        }
                        disabled={busyId === s.id}
                        className="rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900"
                      >
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`font-medium ${
                          s.isActive ? "text-green-600" : "text-gray-400"
                        }`}
                      >
                        {s.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{formatDate(s.createdAt)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(s)}
                        disabled={busyId === s.id}
                        className="min-h-11 rounded border border-gray-300 px-3 text-xs disabled:opacity-40 dark:border-gray-700"
                      >
                        {s.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showAddModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">Add Staff Member</h2>

            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="staff-name">
                  Name
                </label>
                <input
                  id="staff-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="staff-email">
                  Email
                </label>
                <input
                  id="staff-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="staff-password">
                  Temporary password
                </label>
                <input
                  id="staff-password"
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Share this with them directly — they can change it later via &quot;Forgot
                  password&quot; on the login page.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="staff-role">
                  Role
                </label>
                <select
                  id="staff-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "admin" | "staff")}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {createError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {createError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
