type CategoryRef = { name: string; sort_order: number } | null;

export type CategoryGroup<T> = {
  key: string;
  name: string;
  sortOrder: number;
  items: T[];
};

export function groupByCategory<
  T extends { id: string; category_id: string | null; categories: CategoryRef },
>(items: T[]): CategoryGroup<T>[] {
  const groups = new Map<string, CategoryGroup<T>>();

  for (const item of items) {
    const key = item.category_id ?? "uncategorized";
    const name = item.categories?.name ?? "Other";
    const sortOrder = item.categories?.sort_order ?? Number.MAX_SAFE_INTEGER;

    if (!groups.has(key)) {
      groups.set(key, { key, name, sortOrder, items: [] });
    }
    groups.get(key)!.items.push(item);
  }

  return Array.from(groups.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}
