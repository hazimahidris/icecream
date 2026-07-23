"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [resetSent, setResetSent] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabaseBrowser.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError("Incorrect email or password");
      setLoading(false);
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  async function handleForgotPassword() {
    setResetError(null);
    setResetSent(false);

    if (!email.trim()) {
      setResetError("Enter your email above first.");
      return;
    }

    setResetSending(true);
    // Errors aren't surfaced with specifics — a generic confirmation
    // either way avoids revealing whether an email is registered.
    await supabaseBrowser.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/admin/reset-password`,
    });
    setResetSending(false);
    setResetSent(true);
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center px-4 text-gray-900 dark:text-gray-100">
      <h1 className="text-xl font-semibold">Admin Login</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleLogin();
        }}
        className="mt-6 space-y-4"
      >
        <div>
          <label className="text-sm font-medium" htmlFor="admin-email">
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            autoComplete="email"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="admin-password">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>

        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={handleForgotPassword}
          disabled={resetSending}
          className="text-sm text-gray-500 underline disabled:opacity-40"
        >
          {resetSending ? "Sending..." : "Forgot password?"}
        </button>
        {resetSent && (
          <p className="mt-2 text-xs text-gray-500">
            If that email is registered, a reset link has been sent.
          </p>
        )}
        {resetError && <p className="mt-2 text-xs text-red-600">{resetError}</p>}
      </div>
    </main>
  );
}
