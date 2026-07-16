"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ProductImage } from "@/components/ProductImage";
import { groupByCategory, type CategoryGroup } from "@/lib/groupByCategory";

type Product = {
  id: string;
  name: string;
  selling_price: number;
  image_url: string | null;
  category_id: string | null;
  categories: { name: string; sort_order: number } | null;
};

export default function OrderPage() {
  const [groups, setGroups] = useState<CategoryGroup<Product>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // TEMPORARY DEBUGGING — investigating "/order hangs on mobile".
    // Remove this timeout/try-catch once the root cause is found; the
    // original code just awaited the query with no error handling, so
    // a thrown fetch error (network failure, DNS issue, hung request)
    // left the page stuck on "Loading..." forever with nothing logged.
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function loadProducts() {
      setLoading(true);
      setError(null);

      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Timeout — could not reach database")),
          5000
        );
      });

      const query = supabase
        .from("products")
        .select(
          "id, name, selling_price, image_url, category_id, categories(name, sort_order)"
        )
        .eq("is_active", true)
        .order("name");

      try {
        const { data, error } = await Promise.race([query, timeout]);
        clearTimeout(timeoutId);
        if (cancelled) return;

        if (error) {
          setError(error.message);
        } else {
          setGroups(groupByCategory((data ?? []) as unknown as Product[]));
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProducts();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-gray-900 sm:px-6 dark:text-gray-100">
      <h1 className="text-2xl font-semibold">Order</h1>

      {error && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Error loading products: {error}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading...</p>
      ) : error ? null : groups.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">No products available.</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="mt-10">
            <h2 className="text-lg font-medium">{group.name}</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {group.items.map((product) => (
                <div
                  key={product.id}
                  className="flex flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <ProductImage src={product.image_url} alt={product.name} />
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <h3 className="font-medium">{product.name}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      RM {Number(product.selling_price).toFixed(2)}
                    </p>
                    <Link
                      href={`/order/${product.id}`}
                      className="mt-auto flex min-h-11 items-center justify-center rounded bg-gray-900 px-3 py-2 text-center text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
                    >
                      Order
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
