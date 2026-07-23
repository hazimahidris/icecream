"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AdminLogout } from "@/components/AdminLogout";

type Product = {
  id: string;
  name: string;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  sellingPrice: number;
  ingredientCost: number;
  marginPct: number | null;
  maxDailyQty: number | null;
  imageUrl: string | null;
  isActive: boolean;
};

type Category = { id: string; name: string };

type FormState = {
  name: string;
  categoryId: string;
  sellingPrice: string;
  imageUrl: string;
  maxDailyQty: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  categoryId: "",
  sellingPrice: "",
  imageUrl: "",
  maxDailyQty: "",
};

function formatMoney(n: number) {
  return `RM ${n.toFixed(2)}`;
}

function marginStyle(marginPct: number | null) {
  if (marginPct === null) return "text-gray-400";
  if (marginPct < 15) return "font-medium text-red-600";
  if (marginPct < 30) return "font-medium text-amber-600";
  return "font-medium text-green-600";
}

function productToForm(p: Product): FormState {
  return {
    name: p.name,
    categoryId: p.categoryId ?? "",
    sellingPrice: String(p.sellingPrice),
    imageUrl: p.imageUrl ?? "",
    maxDailyQty: p.maxDailyQty !== null ? String(p.maxDailyQty) : "",
  };
}

export default function ProductsPage() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  // null = closed, "new" = create form, otherwise the product id being edited
  const [formTarget, setFormTarget] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadProducts() {
    setLoading(true);
    setLoadError(null);

    const res = await fetch("/api/admin/products");

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error ?? "Failed to load products.");
    } else {
      setProducts(json.products ?? []);
      setCategories(json.categories ?? []);
      setPriceDrafts(
        Object.fromEntries((json.products ?? []).map((p: Product) => [p.id, String(p.sellingPrice)]))
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patchProduct(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      throw new Error("unauthorized");
    }

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error ?? "Request failed.");
    }
  }

  async function handleSavePrice(product: Product) {
    setPriceError(null);
    const draft = priceDrafts[product.id];
    const value = Number(draft);
    if (Number.isNaN(value) || value <= 0) {
      setPriceError("Enter a valid selling price.");
      return;
    }

    setSavingPriceId(product.id);
    try {
      await patchProduct(product.id, { sellingPrice: value });
      loadProducts();
    } catch (err) {
      setPriceError((err as Error).message);
    } finally {
      setSavingPriceId(null);
    }
  }

  async function handleToggleActive(product: Product) {
    setTogglingId(product.id);
    try {
      await patchProduct(product.id, { isActive: !product.isActive });
      loadProducts();
    } catch {
      // surfaced via loadError on next load if it's a persistent issue
    } finally {
      setTogglingId(null);
    }
  }

  function openAddForm() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormTarget("new");
  }

  function openEditForm(product: Product) {
    setForm(productToForm(product));
    setFormError(null);
    setFormTarget(product.id);
  }

  async function handleSaveForm() {
    setFormError(null);

    if (!form.name.trim()) {
      setFormError("Enter a name.");
      return;
    }
    const sellingPrice = Number(form.sellingPrice);
    if (Number.isNaN(sellingPrice) || sellingPrice <= 0) {
      setFormError("Enter a valid selling price.");
      return;
    }

    setSavingForm(true);

    const payload = {
      name: form.name.trim(),
      categoryId: form.categoryId || null,
      sellingPrice,
      imageUrl: form.imageUrl.trim() || null,
      maxDailyQty: form.maxDailyQty === "" ? null : Number(form.maxDailyQty),
    };

    try {
      if (formTarget === "new") {
        const res = await fetch("/api/admin/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 401) {
          router.push("/admin/login");
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not create product.");
      } else if (formTarget) {
        await patchProduct(formTarget, payload);
      }

      setFormTarget(null);
      loadProducts();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSavingForm(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        <AdminLogout />
      </div>

      {loadError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      <button
        type="button"
        onClick={openAddForm}
        className="mt-6 min-h-11 rounded bg-gray-900 px-4 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      >
        Add Product
      </button>

      <section className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium">All Products</h2>
        {priceError && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {priceError}
          </p>
        )}

        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        ) : products.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No products yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Category</th>
                  <th className="pb-2 pr-3">Unit</th>
                  <th className="pb-2 pr-3">Selling Price</th>
                  <th className="pb-2 pr-3">Ingredient Cost/Pcs</th>
                  <th className="pb-2 pr-3">Margin %</th>
                  <th className="pb-2 pr-3">Active</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {products.map((p) => {
                  const draft = priceDrafts[p.id] ?? String(p.sellingPrice);
                  const priceDirty = draft !== String(p.sellingPrice);

                  return (
                    <tr key={p.id}>
                      <td className="py-2 pr-3">{p.name}</td>
                      <td className="py-2 pr-3">{p.categoryName ?? "-"}</td>
                      <td className="py-2 pr-3">{p.unit}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={draft}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                          />
                          {priceDirty && (
                            <button
                              type="button"
                              onClick={() => handleSavePrice(p)}
                              disabled={savingPriceId === p.id}
                              className="min-h-8 rounded border border-gray-300 px-2 text-xs disabled:opacity-40 dark:border-gray-700"
                            >
                              {savingPriceId === p.id ? "..." : "Save"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {p.ingredientCost > 0 ? (
                          formatMoney(p.ingredientCost)
                        ) : (
                          <span className="text-gray-400">No recipe</span>
                        )}
                      </td>
                      <td className={`py-2 pr-3 ${marginStyle(p.marginPct)}`}>
                        {p.marginPct === null ? "-" : `${p.marginPct.toFixed(1)}%`}
                      </td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(p)}
                          disabled={togglingId === p.id}
                          className={`min-h-8 rounded-full px-2 text-xs font-medium disabled:opacity-40 ${
                            p.isActive
                              ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                              : "bg-gray-100 text-gray-500 dark:bg-gray-800"
                          }`}
                        >
                          {p.isActive ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(p)}
                            className="min-h-11 rounded border border-gray-300 px-3 text-xs dark:border-gray-700"
                          >
                            Edit
                          </button>
                          <Link
                            href={`/admin/products/${p.id}/recipe`}
                            className="min-h-11 rounded border border-gray-300 px-3 text-xs leading-[2.75rem] dark:border-gray-700"
                          >
                            View Recipe
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formTarget && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-gray-900">
            <h2 className="text-sm font-medium">
              {formTarget === "new" ? "Add Product" : "Edit Product"}
            </h2>

            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="product-name">
                  Name
                </label>
                <input
                  id="product-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="product-category">
                  Category
                </label>
                <select
                  id="product-category"
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="product-price">
                  Selling price (RM)
                </label>
                <input
                  id="product-price"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="product-image">
                  Image URL (optional)
                </label>
                <input
                  id="product-image"
                  type="text"
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="product-max-daily">
                  Max daily qty (optional)
                </label>
                <input
                  id="product-max-daily"
                  type="number"
                  min={0}
                  step={1}
                  value={form.maxDailyQty}
                  onChange={(e) => setForm({ ...form, maxDailyQty: e.target.value })}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>
            </div>

            {formError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {formError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setFormTarget(null)}
                className="min-h-11 w-full rounded border border-gray-300 text-sm dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveForm}
                disabled={savingForm}
                className="min-h-11 w-full rounded bg-gray-900 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              >
                {savingForm ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
