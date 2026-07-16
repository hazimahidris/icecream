"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AdminLogout } from "@/components/AdminLogout";

type Product = {
  id: string;
  name: string;
  unit: string;
};

type ProductStockRow = {
  product_id: string;
  qty_on_hand: number;
};

type Reservation = {
  id: string;
  status: string;
  qty: number;
  needed_by: string;
  products: { name: string } | null;
};

type Availability = {
  productId: string;
  name: string;
  available: number | null;
  error: string | null;
};

export default function AdminPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Map<string, number>>(
    new Map()
  );
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState("");
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  useEffect(() => {
    async function loadOverview() {
      setLoadingOverview(true);
      setOverviewError(null);

      const [productsRes, stockRes, reservationsRes] = await Promise.all([
        supabase.from("products").select("id, name, unit").order("name"),
        supabase.from("product_stock").select("product_id, qty_on_hand"),
        supabase
          .from("reservations")
          .select("id, status, qty, needed_by, products(name)")
          .order("needed_by"),
      ]);

      if (productsRes.error) {
        setOverviewError(productsRes.error.message);
      } else if (stockRes.error) {
        setOverviewError(stockRes.error.message);
      } else if (reservationsRes.error) {
        setOverviewError(reservationsRes.error.message);
      } else {
        setProducts(productsRes.data ?? []);
        setStockByProduct(
          new Map(
            (stockRes.data as ProductStockRow[]).map((row) => [
              row.product_id,
              row.qty_on_hand,
            ])
          )
        );
        setReservations((reservationsRes.data as unknown as Reservation[]) ?? []);
      }

      setLoadingOverview(false);
    }

    loadOverview();
  }, []);

  useEffect(() => {
    if (!selectedDate || products.length === 0) {
      setAvailability([]);
      return;
    }

    async function loadAvailability() {
      setLoadingAvailability(true);

      const results = await Promise.all(
        products.map(async (product) => {
          const { data, error } = await supabase.rpc("available_stock", {
            p_product_id: product.id,
            p_date: selectedDate,
          });

          return {
            productId: product.id,
            name: product.name,
            available: error ? null : (data as number),
            error: error ? error.message : null,
          };
        })
      );

      setAvailability(results);
      setLoadingAvailability(false);
    }

    loadAvailability();
  }, [selectedDate, products]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <AdminLogout />
      </div>

      {overviewError && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          Error loading data: {overviewError}
        </p>
      )}

      {/* 1. Product stock table */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">Products &amp; Stock</h2>
        <div className="mt-3 overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-4 py-2 text-left font-medium">Unit</th>
                <th className="px-4 py-2 text-left font-medium">Qty on Hand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loadingOverview ? (
                <tr>
                  <td className="px-4 py-3 text-gray-500" colSpan={3}>
                    Loading...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-gray-500" colSpan={3}>
                    No products found.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id}>
                    <td className="px-4 py-2">{product.name}</td>
                    <td className="px-4 py-2">{product.unit}</td>
                    <td className="px-4 py-2">
                      {stockByProduct.get(product.id) ?? 0}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Reservations table */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">Reservations</h2>
        <div className="mt-3 overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-4 py-2 text-left font-medium">Qty</th>
                <th className="px-4 py-2 text-left font-medium">Needed By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loadingOverview ? (
                <tr>
                  <td className="px-4 py-3 text-gray-500" colSpan={4}>
                    Loading...
                  </td>
                </tr>
              ) : reservations.length === 0 ? (
                <tr>
                  <td className="px-4 py-3 text-gray-500" colSpan={4}>
                    No reservations found.
                  </td>
                </tr>
              ) : (
                reservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
                        {reservation.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {reservation.products?.name ?? "-"}
                    </td>
                    <td className="px-4 py-2">{reservation.qty}</td>
                    <td className="px-4 py-2">{reservation.needed_by}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Available stock by date */}
      <section className="mt-10 mb-16">
        <h2 className="text-lg font-medium">Available Stock by Date</h2>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="mt-3 rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
        />

        <div className="mt-3 overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-4 py-2 text-left font-medium">
                  Available Stock
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {!selectedDate ? (
                <tr>
                  <td className="px-4 py-3 text-gray-500" colSpan={2}>
                    Pick a date to see available stock.
                  </td>
                </tr>
              ) : loadingAvailability ? (
                <tr>
                  <td className="px-4 py-3 text-gray-500" colSpan={2}>
                    Loading...
                  </td>
                </tr>
              ) : (
                availability.map((row) => (
                  <tr key={row.productId}>
                    <td className="px-4 py-2">{row.name}</td>
                    <td className="px-4 py-2">
                      {row.error ? (
                        <span className="text-red-600">{row.error}</span>
                      ) : (
                        row.available
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
