"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ProductImage } from "@/components/ProductImage";
import { groupByCategory, type CategoryGroup } from "@/lib/groupByCategory";
import { AdminLogout } from "@/components/AdminLogout";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/paymentMethod";

type Product = {
  id: string;
  name: string;
  image_url: string | null;
  selling_price: number;
  category_id: string | null;
  categories: { name: string; sort_order: number } | null;
};

type CartItem = { productId: string; qty: number };

type PromoDiscount = { id: string; amount: number; label: string };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// "10%" -> 10% off subtotal, "10" -> flat RM10 off. Clamped so a
// discount can never exceed (and invert) the subtotal.
function parseManualDiscount(input: string, subtotal: number): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  if (trimmed.endsWith("%")) {
    const pct = Number(trimmed.slice(0, -1));
    if (Number.isNaN(pct) || pct < 0) return 0;
    return Math.min(subtotal, subtotal * (pct / 100));
  }

  const flat = Number(trimmed);
  if (Number.isNaN(flat) || flat < 0) return 0;
  return Math.min(subtotal, flat);
}

export default function PosPage() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, number | null>>({});
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);

  const [manualDiscountInput, setManualDiscountInput] = useState("");
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoDiscount, setPromoDiscount] = useState<PromoDiscount | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [autoBulkDiscount, setAutoBulkDiscount] = useState<PromoDiscount | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function loadCatalogue() {
    setLoadingProducts(true);
    setProductsError(null);

    const { data, error } = await supabase
      .from("products")
      .select(
        "id, name, image_url, selling_price, category_id, categories(name, sort_order)"
      )
      .eq("is_active", true)
      .order("name");

    if (error) {
      setProductsError(error.message);
      setLoadingProducts(false);
      return;
    }

    const productList = (data ?? []) as unknown as Product[];
    setProducts(productList);

    const today = todayISO();
    const entries = await Promise.all(
      productList.map(async (product) => {
        const { data: stock, error: stockError } = await supabase.rpc(
          "available_stock",
          { p_product_id: product.id, p_date: today }
        );
        return [product.id, stockError ? null : (stock as number)] as const;
      })
    );
    setStockByProduct(Object.fromEntries(entries));

    setLoadingProducts(false);
  }

  useEffect(() => {
    loadCatalogue();
  }, []);

  const groupedProducts: CategoryGroup<Product>[] = groupByCategory(products);

  const cartWithDetails = useMemo(
    () =>
      cart
        .map((item) => {
          const product = products.find((p) => p.id === item.productId);
          return product ? { ...item, product } : null;
        })
        .filter((item): item is CartItem & { product: Product } => item !== null),
    [cart, products]
  );

  const subtotal = cartWithDetails.reduce(
    (sum, item) => sum + item.product.selling_price * item.qty,
    0
  );
  const cartQty = cartWithDetails.reduce((sum, item) => sum + item.qty, 0);

  // Automatic bulk discount — same rule as the customer site. Only
  // checked when staff hasn't overridden with a manual discount or
  // already applied a promo code (those take priority).
  useEffect(() => {
    if (manualDiscountInput.trim() || promoDiscount || cartQty === 0) {
      setAutoBulkDiscount(null);
      return;
    }

    let cancelled = false;

    async function checkBulkDiscount() {
      const res = await fetch("/api/admin/pos/validate-promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "", subtotal, cartQty }),
      });

      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }

      const json = await res.json();
      if (cancelled) return;

      if (res.ok && json.discountId) {
        setAutoBulkDiscount({ id: json.discountId, amount: json.discountAmount, label: json.label });
      } else {
        setAutoBulkDiscount(null);
      }
    }

    checkBulkDiscount();
    return () => {
      cancelled = true;
    };
  }, [cartQty, subtotal, manualDiscountInput, promoDiscount, router]);

  const manualDiscountAmount = manualDiscountInput.trim()
    ? parseManualDiscount(manualDiscountInput, subtotal)
    : 0;
  const discountAmount = manualDiscountInput.trim()
    ? manualDiscountAmount
    : promoDiscount
    ? promoDiscount.amount
    : autoBulkDiscount
    ? autoBulkDiscount.amount
    : 0;
  const discountId = manualDiscountInput.trim()
    ? null
    : promoDiscount
    ? promoDiscount.id
    : autoBulkDiscount
    ? autoBulkDiscount.id
    : null;
  const total = Math.max(0, subtotal - discountAmount);

  function addToCart(productId: string) {
    const available = stockByProduct[productId];
    if (available === 0) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.productId === productId);
      const currentQty = existing?.qty ?? 0;

      if (typeof available === "number" && currentQty >= available) {
        return prev; // already at max stock — no-op
      }

      if (existing) {
        return prev.map((item) =>
          item.productId === productId ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { productId, qty: 1 }];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) => {
      const available = stockByProduct[productId];
      return prev
        .map((item) => {
          if (item.productId !== productId) return item;
          let next = item.qty + delta;
          if (typeof available === "number") next = Math.min(next, available);
          return { ...item, qty: next };
        })
        .filter((item) => item.qty > 0);
    });
  }

  function handleManualDiscountChange(value: string) {
    setManualDiscountInput(value);
    if (value.trim() && promoDiscount) {
      setPromoDiscount(null);
      setPromoCodeInput("");
      setPromoError(null);
    }
  }

  async function handleApplyPromo() {
    setPromoError(null);
    if (!promoCodeInput.trim()) return;

    setApplyingPromo(true);
    const res = await fetch("/api/admin/pos/validate-promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: promoCodeInput.trim(),
        subtotal,
        cartQty,
      }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setApplyingPromo(false);

    if (!res.ok) {
      setPromoError(json.error ?? "Invalid promo code.");
      return;
    }

    setPromoDiscount({
      id: json.discountId,
      amount: json.discountAmount,
      label: json.label,
    });
    setManualDiscountInput("");
  }

  function resetCart() {
    setCart([]);
    setManualDiscountInput("");
    setPromoCodeInput("");
    setPromoDiscount(null);
    setPromoError(null);
    setAutoBulkDiscount(null);
    setPaymentMethod("cash");
  }

  async function handleCheckout() {
    setCheckoutError(null);

    if (cartWithDetails.length === 0) {
      setCheckoutError("Cart is empty.");
      return;
    }

    setCheckingOut(true);

    const res = await fetch("/api/admin/pos/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cartWithDetails.map((item) => ({
          product_id: item.productId,
          qty: item.qty,
          unit_price: item.product.selling_price,
        })),
        paymentMethod,
        subtotal,
        discountAmount,
        discountId,
        total,
      }),
    });

    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }

    const json = await res.json();
    setCheckingOut(false);

    if (!res.ok) {
      setCheckoutError(json.error ?? "Checkout failed.");
      return;
    }

    resetCart();
    router.push(`/admin/pos/receipt/${json.id}`);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">POS</h1>
        <AdminLogout />
      </div>

      {productsError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Error loading products: {productsError}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {/* Left: flavour grid */}
        <div className="lg:w-2/3">
          {loadingProducts ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            groupedProducts.map((group) => (
              <section key={group.key} className="mb-8">
                <h2 className="text-sm font-medium text-gray-500">{group.name}</h2>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {group.items.map((product) => {
                    const stock = stockByProduct[product.id];
                    const soldOut = stock === 0;

                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addToCart(product.id)}
                        disabled={soldOut}
                        className={`overflow-hidden rounded-lg border text-left ${
                          soldOut
                            ? "cursor-not-allowed border-gray-200 opacity-40 dark:border-gray-700"
                            : "border-gray-200 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500"
                        }`}
                      >
                        <ProductImage src={product.image_url} alt={product.name} />
                        <div className="p-2">
                          <p className="text-sm font-medium">{product.name}</p>
                          <p className="text-xs text-gray-500">
                            RM {product.selling_price.toFixed(2)}
                          </p>
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
                              soldOut
                                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                          >
                            {typeof stock === "number"
                              ? soldOut
                                ? "Sold out"
                                : `${stock} available`
                              : "-"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Right: cart + checkout */}
        <div className="lg:w-1/3">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700 lg:sticky lg:top-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Cart</h2>
              {cartQty > 0 && (
                <span className="text-xs text-gray-500">{cartQty} pcs</span>
              )}
            </div>

            {cartWithDetails.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No items yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {cartWithDetails.map((item) => (
                  <li key={item.productId} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.product.name}</p>
                      <p className="text-xs text-gray-500">
                        RM {item.product.selling_price.toFixed(2)} each
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => changeQty(item.productId, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-sm dark:border-gray-700"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm">{item.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeQty(item.productId, 1)}
                        disabled={
                          typeof stockByProduct[item.productId] === "number" &&
                          item.qty >= (stockByProduct[item.productId] as number)
                        }
                        className="flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-sm disabled:opacity-30 dark:border-gray-700"
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="manual-discount">
                  Discount (RM or %)
                </label>
                <input
                  id="manual-discount"
                  type="text"
                  value={manualDiscountInput}
                  onChange={(e) => handleManualDiscountChange(e.target.value)}
                  placeholder="e.g. 10 or 10%"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500" htmlFor="promo-code">
                  Promo code
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="promo-code"
                    type="text"
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value)}
                    placeholder="CODE"
                    className="block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                  />
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    disabled={applyingPromo}
                    className="min-h-11 shrink-0 rounded border border-gray-300 px-3 text-sm font-medium disabled:opacity-40 dark:border-gray-700"
                  >
                    Apply
                  </button>
                </div>
                {promoDiscount && (
                  <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                    Applied: {promoDiscount.label}
                  </p>
                )}
                {promoError && (
                  <p className="mt-1 text-xs text-red-600">{promoError}</p>
                )}
                {!promoDiscount && !manualDiscountInput.trim() && autoBulkDiscount && (
                  <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                    {autoBulkDiscount.label}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500">Payment method</p>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPaymentMethod(value)}
                      className={`min-h-11 rounded border px-1 text-sm font-medium ${
                        paymentMethod === value
                          ? "border-gray-900 bg-gray-50 dark:border-gray-100 dark:bg-gray-800"
                          : "border-gray-300 dark:border-gray-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>RM {subtotal.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>-RM {discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-medium">
                <span>Total</span>
                <span>RM {total.toFixed(2)}</span>
              </div>
            </div>

            {checkoutError && (
              <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                {checkoutError}
              </p>
            )}

            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkingOut || cartWithDetails.length === 0}
              className="mt-4 min-h-11 w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
            >
              {checkingOut ? "Processing..." : "Checkout"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
