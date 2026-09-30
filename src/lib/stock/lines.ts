import type { ActiveProduct, StockLine } from "@/lib/data/queries";
import type { StockUnit } from "@/types/database";
import type { Prices } from "@/lib/stock/ledger";

// A tracked line is a product from the allergen list that has an active
// stock line: the name comes from the product, the unit and prices from the
// line. Deli first, then sandwiches, each alphabetical, so the close count
// walks the shop in a steady order.

export type TrackedLine = {
  lineId: string;
  productId: string;
  name: string;
  category: "deli" | "sandwich";
  unit: StockUnit;
  cost: number | null;
  sell: number | null;
};

export function trackedLines(lines: StockLine[], products: ActiveProduct[]): TrackedLine[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const tracked: TrackedLine[] = [];
  for (const line of lines) {
    const product = byId.get(line.product_id);
    if (!line.active || !product) continue;
    tracked.push({
      lineId: line.id,
      productId: product.id,
      name: product.name,
      category: product.category,
      unit: line.unit,
      cost: line.cost_price,
      sell: line.sell_price,
    });
  }
  return tracked.sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category === "deli" ? -1 : 1));
}

export function pricesOf(lines: StockLine[]): Prices {
  return new Map(lines.map((l) => [l.product_id, { cost: l.cost_price, sell: l.sell_price }]));
}

// "3.5", "3,5", "£3.50" all mean the same thing; anything else is null.
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[£\s]/g, "").replace(",", ".");
  if (cleaned === "" || !/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}
