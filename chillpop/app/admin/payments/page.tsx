"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLogout } from "@/components/AdminLogout";

type PaymentReceipt = {
  id: string;
  amount_claimed: number;
  bank_name: string | null;
  transfer_reference: string | null;
  transfer_datetime: string | null;
  receipt_url: string;
  file_type: string | null;
  verification_status: string;
  submitted_at: string;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  signed_url: string | null;
  orders: {
    id: string;
    order_number: number;
    total: number;
    fulfilment_date: string;
    customers: { name: string | null; phone: string | null } | null;
  } | null;
};

type Tab = "pending" | "approved";

function formatOrderCode(orderNumber: number) {
  return `ORD-${String(orderNumber).padStart(4, "0")}`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString();
}

const ADMIN_NAME_STORAGE_KEY = "chillpop_admin_name";

export default function AdminPaymentsPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("pending");
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [adminName, setAdminName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(ADMIN_NAME_STORAGE_KEY);
    if (stored) setAdminName(stored);
  }, []);

  useEffect(() => {
    loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadReceipts() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch(`/api/admin/payments?status=${tab}`);

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();

    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load payments.");
    } else {
      setReceipts(json.receipts ?? []);
    }

    setLoading(false);
  }

  function saveAdminName(name: string) {
    setAdminName(name);
    window.localStorage.setItem(ADMIN_NAME_STORAGE_KEY, name);
  }

  async function handleApprove(receipt: PaymentReceipt) {
    setActionError(null);
    setSuccessMessage(null);

    if (!adminName.trim()) {
      setActionError("Please enter your name before approving.");
      return;
    }

    setBusyId(receipt.id);
    const res = await fetch(`/api/admin/payments/${receipt.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminName: adminName.trim() }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setBusyId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Failed to approve.");
      return;
    }

    setSuccessMessage("Payment approved. Booking confirmed and stock reserved.");
    loadReceipts();
  }

  async function handleReject(receipt: PaymentReceipt) {
    setActionError(null);
    setSuccessMessage(null);

    const reason = window.prompt("Rejection reason (required):");
    if (!reason || !reason.trim()) return;

    setBusyId(receipt.id);
    const res = await fetch(`/api/admin/payments/${receipt.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setBusyId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Failed to reject.");
      return;
    }

    setSuccessMessage("Payment rejected.");
    loadReceipts();
  }

  async function handleRequestNew(receipt: PaymentReceipt) {
    setActionError(null);
    setSuccessMessage(null);

    if (!window.confirm("Ask the customer to upload a new receipt?")) return;

    setBusyId(receipt.id);
    const res = await fetch(
      `/api/admin/payments/${receipt.id}/request-new`,
      { method: "POST" }
    );

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setBusyId(null);

    if (!res.ok) {
      setActionError(json.error ?? "Failed to request a new receipt.");
      return;
    }

    setSuccessMessage("Requested a new receipt from the customer.");
    loadReceipts();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payments</h1>
        <AdminLogout />
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="admin-name">
          Your name (recorded when you approve a payment)
        </label>
        <input
          id="admin-name"
          type="text"
          value={adminName}
          onChange={(e) => saveAdminName(e.target.value)}
          placeholder="e.g. Siti"
          className="mt-1 block w-64 rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      <div className="mt-6 flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "pending"
              ? "border-b-2 border-gray-900 dark:border-gray-100"
              : "text-gray-500"
          }`}
        >
          Pending
        </button>
        <button
          type="button"
          onClick={() => setTab("approved")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "approved"
              ? "border-b-2 border-gray-900 dark:border-gray-100"
              : "text-gray-500"
          }`}
        >
          Recently Approved
        </button>
      </div>

      {successMessage && (
        <p className="mt-4 rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {successMessage}
        </p>
      )}
      {actionError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Error loading payments: {loadError}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Order ID</th>
              <th className="px-4 py-2 text-left font-medium">Customer</th>
              <th className="px-4 py-2 text-left font-medium">Order Total</th>
              <th className="px-4 py-2 text-left font-medium">
                Amount Claimed
              </th>
              <th className="px-4 py-2 text-left font-medium">
                Transfer Date
              </th>
              <th className="px-4 py-2 text-left font-medium">Receipt</th>
              {tab === "pending" ? (
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              ) : (
                <th className="px-4 py-2 text-left font-medium">
                  Approved By
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading ? (
              <tr>
                <td className="px-4 py-3 text-gray-500" colSpan={7}>
                  Loading...
                </td>
              </tr>
            ) : receipts.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-gray-500" colSpan={7}>
                  {tab === "pending"
                    ? "No pending payments."
                    : "No approved payments yet."}
                </td>
              </tr>
            ) : (
              receipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="px-4 py-2">
                    {receipt.orders
                      ? formatOrderCode(receipt.orders.order_number)
                      : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <div>{receipt.orders?.customers?.name ?? "-"}</div>
                    <div className="text-xs text-gray-500">
                      {receipt.orders?.customers?.phone ?? "-"}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    RM {(receipt.orders?.total ?? 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    RM {receipt.amount_claimed.toFixed(2)}
                  </td>
                  <td className="px-4 py-2">
                    {formatDateTime(receipt.transfer_datetime)}
                  </td>
                  <td className="px-4 py-2">
                    {receipt.signed_url ? (
                      <a
                        href={receipt.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        {receipt.file_type &&
                        ["jpg", "jpeg", "png"].includes(
                          receipt.file_type.toLowerCase()
                        ) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={receipt.signed_url}
                            alt="Receipt thumbnail"
                            className="h-12 w-12 rounded border border-gray-200 object-cover dark:border-gray-700"
                          />
                        ) : (
                          <span className="flex h-12 w-12 items-center justify-center rounded border border-gray-200 text-xs text-gray-500 dark:border-gray-700">
                            PDF
                          </span>
                        )}
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">
                        Unavailable
                      </span>
                    )}
                  </td>
                  {tab === "pending" ? (
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === receipt.id}
                          onClick={() => handleApprove(receipt)}
                          className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busyId === receipt.id}
                          onClick={() => handleReject(receipt)}
                          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={busyId === receipt.id}
                          onClick={() => handleRequestNew(receipt)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium disabled:opacity-40 dark:border-gray-700"
                        >
                          Request New Receipt
                        </button>
                      </div>
                    </td>
                  ) : (
                    <td className="px-4 py-2">
                      <div>{receipt.verified_by ?? "-"}</div>
                      <div className="text-xs text-gray-500">
                        {formatDateTime(receipt.verified_at)}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
