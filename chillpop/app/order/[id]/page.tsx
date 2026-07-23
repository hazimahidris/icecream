"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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

type CartItem = {
  productId: string;
  qty: number;
};

type Addon = {
  id: string;
  name: string;
  type: "purchase" | "rental";
  price: number;
  deposit_amount: number;
};

type DepositTier = {
  min_amount: number;
  max_amount: number | null;
  deposit_value: number;
};

type ResolvedDiscount = {
  discountId: string | null;
  code: string | null;
  type: string | null;
  value: number | null;
  minQty: number | null;
  amount: number;
  source: "promo" | "bulk" | null;
  codeError: string | null;
};

type Step = 1 | 2 | 3 | 4;

type Fulfilment = "pickup" | "delivery";

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const PERIODS = ["AM", "PM"] as const;

// Converts a 12-hour clock selection into the 24-hour "HH:MM:SS" format
// the orders.fulfilment_time column expects.
function toSQLTime(hour: string, period: (typeof PERIODS)[number]) {
  let h = Number(hour);
  if (period === "AM" && h === 12) h = 0;
  if (period === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:00:00`;
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatShortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]}`;
}

// Accepts digits plus common separators (space, dash, leading +), and
// requires a plausible phone-number digit count — rejects things like
// a pasted email address while still allowing "012-345 6789" formatting.
function isValidPhone(value: string) {
  const trimmed = value.trim();
  if (!/^[0-9+\-\s]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 12;
}

export default function ProductOrderPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const seededRef = useRef(false);

  const [step, setStep] = useState<Step>(1);
  const [flavourSearch, setFlavourSearch] = useState("");

  const [fulfilment, setFulfilment] = useState<Fulfilment | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState("");

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedHour, setSelectedHour] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState<
    (typeof PERIODS)[number] | ""
  >("");
  const [dateStockByProduct, setDateStockByProduct] = useState<
    Record<string, number | null>
  >({});
  const [dateStockLoading, setDateStockLoading] = useState(false);

  const [addons, setAddons] = useState<Addon[]>([]);
  const [loadingAddons, setLoadingAddons] = useState(true);
  const [addonsError, setAddonsError] = useState<string | null>(null);
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [remarks, setRemarks] = useState("");

  const [depositTiers, setDepositTiers] = useState<DepositTier[]>([]);
  const [depositTiersError, setDepositTiersError] = useState<string | null>(
    null
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [promoInput, setPromoInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [resolvedDiscount, setResolvedDiscount] = useState<ResolvedDiscount | null>(null);
  const [checkingDiscount, setCheckingDiscount] = useState(false);

  useEffect(() => {
    async function loadProducts() {
      setLoadingProducts(true);
      setProductsError(null);

      const { data, error } = await supabase
        .from("products")
        .select(
          "id, name, selling_price, image_url, category_id, categories(name, sort_order)"
        )
        .eq("is_active", true)
        .order("name");

      if (error) {
        setProductsError(error.message);
      } else {
        setProducts((data ?? []) as unknown as Product[]);
      }

      setLoadingProducts(false);
    }

    async function loadAddons() {
      setLoadingAddons(true);
      setAddonsError(null);

      const { data, error } = await supabase
        .from("addons")
        .select("id, name, type, price, deposit_amount")
        .eq("is_active", true)
        .order("name");

      if (error) {
        setAddonsError(error.message);
      } else {
        setAddons((data ?? []) as Addon[]);
      }

      setLoadingAddons(false);
    }

    async function loadDepositTiers() {
      const { data, error } = await supabase
        .from("deposit_tiers")
        .select("min_amount, max_amount, deposit_value")
        .order("sort_order");

      if (error) {
        setDepositTiersError(error.message);
      } else {
        setDepositTiers((data ?? []) as DepositTier[]);
      }
    }

    loadProducts();
    loadAddons();
    loadDepositTiers();
  }, []);

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const otherProducts = products.filter((p) => p.id !== productId);

  const filteredOtherProducts = otherProducts.filter((p) =>
    p.name.toLowerCase().includes(flavourSearch.trim().toLowerCase())
  );
  const groupedOtherProducts: CategoryGroup<Product>[] =
    groupByCategory(filteredOtherProducts);

  // Seed the cart with the confirmed flavour once it's loaded.
  useEffect(() => {
    if (selectedProduct && !seededRef.current) {
      seededRef.current = true;
      setCart([{ productId: selectedProduct.id, qty: 1 }]);
    }
  }, [selectedProduct]);

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

  const productTotal = cartWithDetails.reduce(
    (sum, item) => sum + item.product.selling_price * item.qty,
    0
  );

  const addonTotal = addons.reduce(
    (sum, addon) => sum + (addonQty[addon.id] ?? 0) * addon.price,
    0
  );

  const total = productTotal + addonTotal;
  const totalPcs = cartWithDetails.reduce((sum, item) => sum + item.qty, 0);

  const discountAmount = resolvedDiscount?.amount ?? 0;
  const finalTotal = Math.max(0, total - discountAmount);

  const timeSelected = selectedHour !== "" && selectedPeriod !== "";
  const selectedTime = timeSelected
    ? toSQLTime(selectedHour, selectedPeriod as (typeof PERIODS)[number])
    : "";

  // Resolves both the automatic bulk discount and (if the customer
  // applied one) a promo code in a single server-side call — the RPC
  // itself decides which one wins when both are eligible, so there's
  // no discount-comparison logic duplicated here.
  useEffect(() => {
    if (step !== 4 || totalPcs === 0) {
      setResolvedDiscount(null);
      return;
    }

    let cancelled = false;
    setCheckingDiscount(true);

    async function checkDiscount() {
      const { data, error } = await supabase.rpc("find_applicable_discount", {
        p_code: appliedCode || null,
        p_cart_qty: totalPcs,
        p_subtotal: total,
      });

      if (cancelled) return;
      setCheckingDiscount(false);

      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) {
        setResolvedDiscount(null);
        return;
      }

      setResolvedDiscount({
        discountId: row.discount_id,
        code: row.discount_code,
        type: row.discount_type,
        value: row.discount_value,
        minQty: row.discount_min_qty,
        amount: Number(row.discount_amount),
        source: row.source,
        codeError: row.code_error,
      });
    }

    checkDiscount();
    return () => {
      cancelled = true;
    };
  }, [step, totalPcs, total, appliedCode]);

  function handleApplyPromo() {
    setAppliedCode(promoInput.trim());
  }

  function handleClearPromo() {
    setPromoInput("");
    setAppliedCode("");
  }

  function toggleFlavour(id: string) {
    setCart((prev) => {
      if (prev.some((item) => item.productId === id)) {
        return prev.filter((item) => item.productId !== id);
      }
      return [...prev, { productId: id, qty: 1 }];
    });
  }

  function updateQty(id: string, qty: number, max: number | null) {
    setCart((prev) =>
      prev.map((item) => {
        if (item.productId !== id) return item;
        let next = Math.max(1, qty);
        if (typeof max === "number") next = Math.min(next, max);
        return { ...item, qty: next };
      })
    );
  }

  function updateAddonQty(id: string, qty: number) {
    setAddonQty((prev) => ({ ...prev, [id]: Math.max(0, qty) }));
  }

  const dateSelected = selectedDate !== "";
  const cartProductIds = cart.map((item) => item.productId).sort().join(",");

  // As soon as a date is picked, fetch available stock on that date for
  // every flavour in the cart.
  useEffect(() => {
    if (step !== 2 || !dateSelected || cartProductIds === "") return;

    let cancelled = false;
    const ids = cartProductIds.split(",");

    async function loadDateStock() {
      setDateStockLoading(true);

      const entries = await Promise.all(
        ids.map(async (id) => {
          const { data, error } = await supabase.rpc("available_stock", {
            p_product_id: id,
            p_date: selectedDate,
          });
          return [id, error ? null : (data as number)] as const;
        })
      );

      if (!cancelled) {
        const stockMap = Object.fromEntries(entries);
        setDateStockByProduct(stockMap);

        // A quantity picked for a previous date (e.g. 100 pcs when 130
        // were available) can exceed what's available on the newly
        // selected date — clamp it down rather than leaving a stale,
        // now-invalid value sitting in the input.
        setCart((prev) =>
          prev.map((item) => {
            const available = stockMap[item.productId];
            return typeof available === "number" &&
              available > 0 &&
              item.qty > available
              ? { ...item, qty: available }
              : item;
          })
        );

        setDateStockLoading(false);
      }
    }

    loadDateStock();
    return () => {
      cancelled = true;
    };
  }, [step, dateSelected, selectedDate, cartProductIds]);

  const fulfilmentReady =
    fulfilment === "pickup" ||
    (fulfilment === "delivery" && deliveryAddress.trim().length > 0);

  const hasZeroAvailability = cartWithDetails.some(
    (item) => dateStockByProduct[item.productId] === 0
  );

  const step2Ready =
    fulfilmentReady &&
    dateSelected &&
    timeSelected &&
    !dateStockLoading &&
    !hasZeroAvailability;

  const step3Ready =
    customerName.trim() !== "" &&
    isValidPhone(customerPhone) &&
    (fulfilment !== "delivery" || deliveryAddress.trim() !== "");

  // Deposit is based on the post-discount total — what the customer
  // actually owes, not the pre-discount subtotal.
  const matchedDepositTier = depositTiers.find(
    (tier) =>
      finalTotal >= tier.min_amount &&
      (tier.max_amount === null || finalTotal <= tier.max_amount)
  );
  // Falls back to full payment if no tier matches (e.g. the tiers were
  // edited in /admin/settings/deposit-tiers and now leave a gap).
  const depositPercent = matchedDepositTier?.deposit_value ?? 100;
  const amountToPayNow = finalTotal * (depositPercent / 100);
  const balanceDue = finalTotal - amountToPayNow;

  async function handleConfirmOrder() {
    setSubmitting(true);
    setSubmitError(null);

    // place_order() does the availability re-check, customer lookup,
    // order/order_items/reservations inserts all inside one Postgres
    // function call — atomic, so a failure partway through can't leave
    // an orphaned order with no line items.
    const { data: orderId, error } = await supabase.rpc("place_order", {
      p_customer_name: customerName.trim(),
      p_customer_phone: customerPhone.trim(),
      p_customer_email: customerEmail.trim() || null,
      p_fulfilment_type: fulfilment,
      p_fulfilment_date: selectedDate,
      p_fulfilment_time: selectedTime,
      p_delivery_address:
        fulfilment === "delivery" ? deliveryAddress.trim() : null,
      p_remarks: remarks.trim() || null,
      p_subtotal: total,
      p_deposit_required: amountToPayNow,
      p_items: cartWithDetails.map((item) => ({
        product_id: item.productId,
        qty: item.qty,
        unit_price: item.product.selling_price,
      })),
      p_addons: addons
        .filter((addon) => (addonQty[addon.id] ?? 0) > 0)
        .map((addon) => ({
          addon_id: addon.id,
          qty: addonQty[addon.id],
          unit_price: addon.price,
        })),
      // The server independently re-validates and recomputes the
      // discount from this code — it never trusts a client-computed
      // amount (place_order is reachable directly with the public
      // anon key, so a client-submitted discount would be a way to
      // hand yourself an arbitrary discount).
      p_promo_code: appliedCode || null,
    });

    if (error || !orderId) {
      setSubmitError(error?.message ?? "Could not place order.");
      setSubmitting(false);
      return;
    }

    router.push(`/order/${orderId}/payment`);
  }

  if (loadingProducts) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-sm text-gray-500">
        Loading...
      </main>
    );
  }

  if (productsError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Error loading products: {productsError}
        </p>
      </main>
    );
  }

  if (!selectedProduct) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-gray-500">Product not found.</p>
        <Link href="/order" className="mt-2 inline-block text-sm underline">
          Back to menu
        </Link>
      </main>
    );
  }

  const stepLabels: Record<Step, string> = {
    1: "Flavour",
    2: "Order Details",
    3: "Your Details",
    4: "Review & Confirm",
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-gray-900 sm:px-6 dark:text-gray-100">
      <Link href="/order" className="text-sm text-gray-500 underline">
        Back to menu
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Step {step} of 4 — {stepLabels[step]}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Total: RM {total.toFixed(2)}
        </p>
      </div>

      {/* Step 1 — Flavour confirmed */}
      {step === 1 && (
        <div className="mt-6">
          <div className="flex gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="w-24 shrink-0">
              <ProductImage
                src={selectedProduct.image_url}
                alt={selectedProduct.name}
                className="rounded-lg"
              />
            </div>
            <div>
              <p className="text-xs text-gray-500">Your flavour</p>
              <h2 className="font-medium">{selectedProduct.name}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                RM {selectedProduct.selling_price.toFixed(2)}
              </p>
            </div>
          </div>

          {otherProducts.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium">Add other flavours</h3>
              <input
                type="text"
                value={flavourSearch}
                onChange={(e) => setFlavourSearch(e.target.value)}
                placeholder="Search flavours..."
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
              />

              {groupedOtherProducts.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">
                  No flavours match your search.
                </p>
              ) : (
                groupedOtherProducts.map((group) => (
                  <div key={group.key} className="mt-4">
                    <h4 className="text-xs font-medium text-gray-500">
                      {group.name}
                    </h4>
                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {group.items.map((product) => {
                        const inCart = cart.some(
                          (c) => c.productId === product.id
                        );
                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => toggleFlavour(product.id)}
                            className={`rounded-lg border p-3 text-left ${
                              inCart
                                ? "border-gray-900 dark:border-gray-100"
                                : "border-gray-200 dark:border-gray-700"
                            }`}
                          >
                            <p className="text-sm font-medium">
                              {product.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              RM {product.selling_price.toFixed(2)}
                            </p>
                            <p className="mt-1 text-xs">
                              {inCart ? "✓ Added" : "+ Add"}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h3 className="text-sm font-medium">Your cart</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {cartWithDetails.map((item) => (
                <li key={item.productId} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {item.product.name} x{item.qty}
                  </span>
                  <span className="shrink-0">
                    RM {(item.product.selling_price * item.qty).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm font-medium dark:border-gray-700">
              <span>Total</span>
              <span>RM {productTotal.toFixed(2)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            className="mt-6 w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
          >
            Next
          </button>
        </div>
      )}

      {/* Step 2 — Fulfilment, date & time, quantity, add-ons */}
      {step === 2 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium">Fulfilment</h3>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setFulfilment("pickup")}
              className={`rounded-lg border p-6 text-center text-lg font-medium ${
                fulfilment === "pickup"
                  ? "border-gray-900 bg-gray-50 dark:border-gray-100 dark:bg-gray-800"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              Pickup
            </button>
            <button
              type="button"
              onClick={() => setFulfilment("delivery")}
              className={`rounded-lg border p-6 text-center text-lg font-medium ${
                fulfilment === "delivery"
                  ? "border-gray-900 bg-gray-50 dark:border-gray-100 dark:bg-gray-800"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              Delivery
            </button>
          </div>

          {fulfilment === "delivery" && (
            <div className="mt-4">
              <label className="text-sm font-medium" htmlFor="delivery-address">
                Delivery address
              </label>
              <textarea
                id="delivery-address"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                placeholder="Enter your delivery address"
              />
            </div>
          )}

          <h3 className="mt-8 text-sm font-medium">Date &amp; Time</h3>
          <label className="mt-2 block text-sm font-medium" htmlFor="fulfilment-date">
            Date
          </label>
          <input
            id="fulfilment-date"
            type="date"
            min={todayISO()}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
          />

          <label className="mt-4 block text-sm font-medium" htmlFor="fulfilment-hour">
            Time
          </label>
          <div className="mt-1 flex gap-2">
            <select
              id="fulfilment-hour"
              value={selectedHour}
              onChange={(e) => setSelectedHour(e.target.value)}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">Hour</option>
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hour}
                </option>
              ))}
            </select>
            <select
              value={selectedPeriod}
              onChange={(e) =>
                setSelectedPeriod(e.target.value as (typeof PERIODS)[number])
              }
              className="block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="">AM/PM</option>
              {PERIODS.map((period) => (
                <option key={period} value={period}>
                  {period}
                </option>
              ))}
            </select>
          </div>

          {dateStockLoading && (
            <p className="mt-4 text-xs text-gray-500">
              Checking availability...
            </p>
          )}

          {dateSelected ? (
            <>
              <h3 className="mt-8 text-sm font-medium">Quantity</h3>
              <div className="mt-2 space-y-4">
                {cartWithDetails.map((item) => {
                  const available = dateStockByProduct[item.productId];
                  const soldOut = available === 0;

                  return (
                    <div
                      key={item.productId}
                      className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                    >
                      <p className="text-sm font-medium">
                        {item.product.name} — available on{" "}
                        {formatShortDate(selectedDate)}:{" "}
                        {typeof available === "number" ? available : "-"} pcs
                      </p>

                      {soldOut && (
                        <p className="mt-2 text-xs text-red-600">
                          {item.product.name} is not available on{" "}
                          {formatShortDate(selectedDate)}. Please choose a
                          different date.
                        </p>
                      )}
                      <input
                        type="number"
                        min={1}
                        max={
                          typeof available === "number" ? available : undefined
                        }
                        value={item.qty}
                        disabled={soldOut}
                        onChange={(e) =>
                          updateQty(
                            item.productId,
                            Number(e.target.value),
                            typeof available === "number" ? available : null
                          )
                        }
                        className="mt-2 w-20 rounded border border-gray-300 px-2 py-1 text-center disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:disabled:bg-gray-800"
                      />
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mt-8 text-sm text-gray-500">
              Select a date to choose quantities.
            </p>
          )}

          <h3 className="mt-8 text-sm font-medium">Add-ons</h3>
          {addonsError && (
            <p className="mt-2 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              Error loading add-ons: {addonsError}
            </p>
          )}

          {loadingAddons ? (
            <p className="mt-2 text-sm text-gray-500">Loading add-ons...</p>
          ) : addons.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No add-ons available.</p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {addons.map((addon) => (
                <div
                  key={addon.id}
                  className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{addon.name}</p>
                      <p className="text-xs capitalize text-gray-500">
                        {addon.type}
                      </p>
                    </div>
                    <p className="text-sm">RM {addon.price.toFixed(2)}</p>
                  </div>

                  {addon.type === "rental" && (
                    <p className="mt-2 text-xs text-gray-500">
                      Deposit: RM {addon.deposit_amount.toFixed(2)} — Deposit
                      refundable on return
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <label
                      className="text-xs text-gray-500"
                      htmlFor={`addon-qty-${addon.id}`}
                    >
                      Qty
                    </label>
                    <input
                      id={`addon-qty-${addon.id}`}
                      type="number"
                      min={0}
                      value={addonQty[addon.id] ?? 0}
                      onChange={(e) =>
                        updateAddonQty(addon.id, Number(e.target.value))
                      }
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-center dark:border-gray-700 dark:bg-gray-900"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h3 className="text-sm font-medium">Order summary</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {cartWithDetails.map((item) => (
                <li key={item.productId} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {item.product.name} x{item.qty}
                  </span>
                  <span className="shrink-0">
                    RM {(item.product.selling_price * item.qty).toFixed(2)}
                  </span>
                </li>
              ))}
              {addons
                .filter((addon) => (addonQty[addon.id] ?? 0) > 0)
                .map((addon) => (
                  <li key={addon.id} className="flex justify-between gap-2">
                    <span className="min-w-0 break-words">
                      {addon.name} x{addonQty[addon.id]}
                    </span>
                    <span className="shrink-0">
                      RM {(addon.price * (addonQty[addon.id] ?? 0)).toFixed(2)}
                    </span>
                  </li>
                ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm font-medium dark:border-gray-700">
              <span>Total</span>
              <span>RM {total.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="w-full rounded border border-gray-300 px-4 py-3 text-sm font-medium dark:border-gray-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!step2Ready}
              onClick={() => setStep(3)}
              className="w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Customer details */}
      {step === 3 && (
        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="customer-name">
              Name
            </label>
            <input
              id="customer-name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="customer-phone">
              Mobile number
            </label>
            <input
              id="customer-phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
              placeholder="012-3456789"
            />
            {customerPhone.trim() !== "" && !isValidPhone(customerPhone) ? (
              <p className="mt-1 text-xs text-red-600">
                Please enter a valid mobile number.
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">e.g. 012-3456789</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="customer-email">
              Email (optional)
            </label>
            <input
              id="customer-email"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
              placeholder="you@example.com"
            />
          </div>

          {fulfilment === "delivery" && (
            <div>
              <label
                className="text-sm font-medium"
                htmlFor="customer-delivery-address"
              >
                Delivery address
              </label>
              <textarea
                id="customer-delivery-address"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                placeholder="Enter your delivery address"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium" htmlFor="customer-remarks">
              Remarks (optional)
            </label>
            <textarea
              id="customer-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
              placeholder="e.g. extra dry ice please"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full rounded border border-gray-300 px-4 py-3 text-sm font-medium dark:border-gray-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!step3Ready}
              onClick={() => setStep(4)}
              className="w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Order summary */}
      {step === 4 && (
        <div className="mt-6">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h3 className="text-sm font-medium">Flavours</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {cartWithDetails.map((item) => (
                <li key={item.productId} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {item.product.name} x{item.qty}
                  </span>
                  <span className="shrink-0">
                    RM {(item.product.selling_price * item.qty).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>

            {addons.some((addon) => (addonQty[addon.id] ?? 0) > 0) && (
              <>
                <h3 className="mt-4 text-sm font-medium">Add-ons</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {addons
                    .filter((addon) => (addonQty[addon.id] ?? 0) > 0)
                    .map((addon) => (
                      <li key={addon.id} className="flex justify-between gap-2">
                        <span className="min-w-0 break-words">
                          {addon.name} x{addonQty[addon.id]}
                        </span>
                        <span className="shrink-0">
                          RM{" "}
                          {(addon.price * (addonQty[addon.id] ?? 0)).toFixed(
                            2
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
              </>
            )}

            <div className="mt-4 space-y-1 border-t border-gray-200 pt-3 text-sm dark:border-gray-700">
              <p>
                <span className="text-gray-500">Fulfilment: </span>
                <span className="capitalize">{fulfilment}</span>
              </p>
              <p>
                <span className="text-gray-500">Date: </span>
                {formatShortDate(selectedDate)}
              </p>
              <p>
                <span className="text-gray-500">Time: </span>
                {timeSelected ? `${selectedHour}:00 ${selectedPeriod}` : "-"}
              </p>
              {fulfilment === "delivery" && (
                <p>
                  <span className="text-gray-500">Deliver to: </span>
                  {deliveryAddress}
                </p>
              )}
            </div>

            <div className="mt-4 space-y-1 border-t border-gray-200 pt-3 text-sm dark:border-gray-700">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>RM {total.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-green-700 dark:text-green-400">
                  <span>Discount</span>
                  <span>-RM {discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span>RM {finalTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <label className="text-sm font-medium" htmlFor="promo-code">
              Have a promo code?
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="promo-code"
                type="text"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                placeholder="CODE"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-base uppercase dark:border-gray-700 dark:bg-gray-900"
              />
              {appliedCode ? (
                <button
                  type="button"
                  onClick={handleClearPromo}
                  className="min-h-11 shrink-0 rounded border border-gray-300 px-3 text-sm font-medium dark:border-gray-700"
                >
                  Clear
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleApplyPromo}
                  disabled={checkingDiscount || !promoInput.trim()}
                  className="min-h-11 shrink-0 rounded border border-gray-300 px-3 text-sm font-medium disabled:opacity-40 dark:border-gray-700"
                >
                  Apply
                </button>
              )}
            </div>

            {checkingDiscount && (
              <p className="mt-2 text-xs text-gray-500">Checking...</p>
            )}

            {!checkingDiscount && appliedCode && resolvedDiscount?.codeError && (
              <p className="mt-2 text-xs text-red-600">Code not found or expired</p>
            )}

            {!checkingDiscount &&
              appliedCode &&
              !resolvedDiscount?.codeError &&
              resolvedDiscount?.source === "promo" && (
                <p className="mt-2 text-xs text-green-700 dark:text-green-400">
                  Promo code {resolvedDiscount.code} applied: -RM{" "}
                  {resolvedDiscount.amount.toFixed(2)}
                </p>
              )}

            {!checkingDiscount &&
              appliedCode &&
              !resolvedDiscount?.codeError &&
              resolvedDiscount?.source === "bulk" && (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  Your code is valid, but the automatic bulk discount below is larger and
                  was applied instead.
                </p>
              )}

            {!checkingDiscount && !appliedCode && resolvedDiscount?.source === "bulk" && (
              <p className="mt-2 text-xs text-green-700 dark:text-green-400">
                Bulk order discount applied: {resolvedDiscount.value}% off for orders of{" "}
                {resolvedDiscount.minQty}+ pcs
              </p>
            )}
          </div>

          {depositTiersError && (
            <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              Error loading deposit tiers: {depositTiersError}
            </p>
          )}

          <div className="mt-4 rounded-lg border border-gray-900 p-4 dark:border-gray-100">
            <p className="text-sm font-medium">
              Amount to pay now: RM {amountToPayNow.toFixed(2)}
            </p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Balance due at {fulfilment ?? "pickup/delivery"}: RM{" "}
              {balanceDue.toFixed(2)}
            </p>
          </div>

          <p className="mt-4 rounded border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            Note: availability is checked at submission. If another customer
            books the same date between now and when you submit, stock may
            change.
          </p>

          {submitError && (
            <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
              {submitError}
            </p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={submitting}
              className="w-full rounded border border-gray-300 px-4 py-3 text-sm font-medium disabled:opacity-40 dark:border-gray-700"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirmOrder}
              disabled={submitting}
              className="w-full rounded bg-gray-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
            >
              {submitting ? "Placing order..." : "Confirm Order"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
