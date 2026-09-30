import type { StockLogRow, StockUnit } from "@/types/database";
import { daysBetween, localDateStr } from "@/lib/counter/board";

// The stock tracker's numbers, derived from the append-only stock log and
// never stored. One formula drives everything:
//
//   sold = last count + came in − binned − left now
//
// where "came in" and "binned" are whatever happened since the last count.
// A missed night therefore isn't lost: the next count covers both days and
// is marked as doing so. A recount on the same day replaces the earlier one
// (latest wins). A negative result can't be real sales — it means a missed
// delivery or a miscount — so it is kept out of the totals and flagged.

export type StockLog = Pick<
  StockLogRow,
  | "id"
  | "client_id"
  | "staff_id"
  | "event"
  | "product_id"
  | "product_name"
  | "unit"
  | "came_in"
  | "binned"
  | "on_hand"
  | "tags"
  | "note"
  | "business_date"
  | "recorded_at"
>;

// Keys must match STOCK_TAGS in src/lib/security/policy.ts and the database.
export const TAG_LABELS: Record<string, string> = {
  sunny: "☀️ Sunny",
  hot: "🥵 Hot",
  rain: "🌧️ Rain",
  cold: "🥶 Cold",
  busy: "🔥 Busy",
  quiet: "😴 Quiet",
  event: "🎪 Event in town",
  bank_holiday: "🏦 Bank holiday",
  school_holidays: "🎒 School holidays",
  short_staffed: "👤 Short-staffed",
  closed_early: "🚪 Closed early",
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type Prices = Map<string, { cost: number | null; sell: number | null }>; // keyed by product id

export function logDay(log: Pick<StockLog, "business_date" | "recorded_at">): string {
  return log.business_date ?? localDateStr(new Date(log.recorded_at));
}

export function stockKey(productId: string | null, productName: string | null): string {
  return productId ?? `name:${(productName ?? "").trim().toLowerCase()}`;
}

export function shiftDay(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

export function weekdayIndex(dateStr: string): number {
  return (new Date(`${dateStr}T12:00:00`).getDay() + 6) % 7; // Monday = 0
}

export function weekStart(dateStr: string): string {
  return shiftDay(dateStr, -weekdayIndex(dateStr));
}

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

export function formatQty(n: number, unit: StockUnit): string {
  if (unit === "kg") return `${round(n, 2).toFixed(n !== 0 && Math.abs(n) < 10 ? 2 : 1)} kg`;
  return String(round(n, 1));
}

export function formatMoney(n: number): string {
  return `${n < 0 ? "−" : ""}£${Math.abs(n).toFixed(2)}`;
}

export function formatShortDay(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// The count that stands for each product on each day: the latest one.
export function countsByProduct(logs: StockLog[]): Map<string, StockLog[]> {
  const latest = new Map<string, StockLog>();
  for (const log of logs) {
    if (log.event !== "count" || log.on_hand == null) continue;
    const slot = `${stockKey(log.product_id, log.product_name)}|${logDay(log)}`;
    const held = latest.get(slot);
    if (!held || log.recorded_at > held.recorded_at) latest.set(slot, log);
  }
  const byProduct = new Map<string, StockLog[]>();
  for (const log of latest.values()) {
    const key = stockKey(log.product_id, log.product_name);
    byProduct.set(key, [...(byProduct.get(key) ?? []), log]);
  }
  for (const list of byProduct.values()) list.sort((a, b) => logDay(a).localeCompare(logDay(b)));
  return byProduct;
}

// Each product's most recent count strictly before `day` — the "last count"
// the close-count screen starts from.
export function lastCountsBefore(logs: StockLog[], day: string): Map<string, StockLog> {
  const result = new Map<string, StockLog>();
  for (const [key, counts] of countsByProduct(logs)) {
    const before = counts.filter((c) => logDay(c) < day);
    if (before.length) result.set(key, before[before.length - 1]);
  }
  return result;
}

export type SaleDay = {
  key: string;
  productId: string | null;
  productName: string;
  unit: StockUnit;
  date: string; // the count that closes the period
  prevDate: string; // the count it runs from
  spanDays: number; // 1 = a normal night-to-night figure
  opening: number;
  cameIn: number;
  binned: number;
  closing: number;
  sold: number; // negative = can't be right: missed delivery or miscount
};

export function saleDays(logs: StockLog[]): SaleDay[] {
  const days: SaleDay[] = [];
  for (const [key, counts] of countsByProduct(logs)) {
    for (let i = 1; i < counts.length; i++) {
      const prev = counts[i - 1];
      const cur = counts[i];
      const cameIn = cur.came_in ?? 0;
      const binned = cur.binned ?? 0;
      days.push({
        key,
        productId: cur.product_id ?? prev.product_id,
        productName: (cur.product_name ?? "").trim(),
        unit: cur.unit ?? prev.unit ?? "each",
        date: logDay(cur),
        prevDate: logDay(prev),
        spanDays: daysBetween(logDay(prev), logDay(cur)),
        opening: prev.on_hand!,
        cameIn,
        binned,
        closing: cur.on_hand!,
        sold: round(prev.on_hand! + cameIn - binned - cur.on_hand!),
      });
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date) || a.productName.localeCompare(b.productName));
}

export type SoldOut = { date: string; time: string };

export type ProductWeek = {
  key: string;
  productName: string;
  unit: StockUnit;
  sold: number;
  revenue: number | null; // null = no sell price set
  profit: number | null; // null = cost or sell price missing
  margin: number | null; // profit as a % of sales
  binned: number;
  wasteCost: number | null;
  byWeekday: (number | null)[]; // Mon..Sun, one-night figures only
  soldOuts: SoldOut[]; // earliest per day
  prevWeeksAvg: number | null; // average sold over the same days of the comparison weeks that had counts
  checks: string[]; // figures that don't add up
};

export type DayNote = { date: string; tags: string[]; note: string | null };

export type WeekReport = {
  from: string; // Monday
  to: string; // Sunday
  through: string; // last day with figures: Sunday, or today for the week in progress
  products: ProductWeek[];
  totals: { revenue: number; cost: number; profit: number; wasteCost: number };
  unpriced: string[]; // sold this week with no sell price
  countDays: string[]; // days with at least one count
  notes: DayNote[];
};

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// `upTo` (usually today) cuts a week in progress short, so "vs the last 4
// weeks" compares Mon–Wed with earlier Mon–Weds, not with whole weeks.
export function weekReport(logs: StockLog[], prices: Prices, from: string, upTo?: string, compareWeeks = 4): WeekReport {
  const to = shiftDay(from, 6);
  const through = upTo && upTo < to ? upTo : to;
  const inRange = (d: string, a: string, b: string) => d >= a && d <= b;
  const sales = saleDays(logs);
  const products = new Map<string, ProductWeek>();
  const row = (key: string, productName: string, unit: StockUnit): ProductWeek => {
    let entry = products.get(key);
    if (!entry) {
      entry = { key, productName, unit, sold: 0, revenue: null, profit: null, margin: null, binned: 0, wasteCost: null, byWeekday: Array(7).fill(null), soldOuts: [], prevWeeksAvg: null, checks: [] };
      products.set(key, entry);
    }
    return entry;
  };

  for (const day of sales) {
    if (!inRange(day.date, from, to)) continue;
    const entry = row(day.key, day.productName, day.unit);
    entry.binned = round(entry.binned + day.binned);
    const label = WEEKDAYS[weekdayIndex(day.date)];
    if (day.sold < 0) {
      entry.checks.push(`${label}: ${formatQty(day.sold, day.unit)} sold — more left than there should be (missed delivery or miscount?)`);
      continue;
    }
    entry.sold = round(entry.sold + day.sold);
    if (day.spanDays === 1) entry.byWeekday[weekdayIndex(day.date)] = day.sold;
    else entry.checks.push(`${label}'s figure covers ${day.spanDays} days (no count in between)`);
  }

  const firstByDay = new Map<string, string>();
  for (const log of logs) {
    if (log.event !== "sold_out" || !inRange(logDay(log), from, to)) continue;
    const slot = `${stockKey(log.product_id, log.product_name)}|${logDay(log)}`;
    const held = firstByDay.get(slot);
    if (!held || log.recorded_at < held) firstByDay.set(slot, log.recorded_at);
    row(stockKey(log.product_id, log.product_name), (log.product_name ?? "").trim(), log.unit ?? "each");
  }
  for (const [slot, at] of firstByDay) {
    const [key, date] = slot.split("|");
    products.get(key)!.soldOuts.push({ date, time: clockOf(at) });
  }

  const totals = { revenue: 0, cost: 0, profit: 0, wasteCost: 0 };
  const unpriced: string[] = [];
  for (const entry of products.values()) {
    entry.soldOuts.sort((a, b) => a.date.localeCompare(b.date));
    const price = entry.key.startsWith("name:") ? undefined : prices.get(entry.key);
    if (price?.sell != null) {
      entry.revenue = round(entry.sold * price.sell, 2);
      totals.revenue += entry.revenue;
    } else if (entry.sold > 0) unpriced.push(entry.productName);
    if (price?.cost != null) {
      entry.wasteCost = round(entry.binned * price.cost, 2);
      totals.wasteCost += entry.wasteCost;
      if (entry.revenue != null) {
        const cost = round(entry.sold * price.cost, 2);
        entry.profit = round(entry.revenue - cost, 2);
        entry.margin = entry.revenue > 0 ? Math.round((entry.profit / entry.revenue) * 100) : null;
        totals.cost += cost;
        totals.profit += entry.profit;
      }
    }
    const weekly: number[] = [];
    for (let w = 1; w <= compareWeeks; w++) {
      const a = shiftDay(from, -7 * w);
      const b = shiftDay(through, -7 * w);
      const days = sales.filter((s) => s.key === entry.key && inRange(s.date, a, b) && s.sold >= 0);
      if (days.length) weekly.push(days.reduce((n, s) => n + s.sold, 0));
    }
    entry.prevWeeksAvg = weekly.length ? round(weekly.reduce((n, v) => n + v, 0) / weekly.length, 2) : null;
  }

  const countDays = [...new Set(logs.filter((l) => l.event === "count" && inRange(logDay(l), from, to)).map(logDay))].sort();
  // Latest note for the day wins, like a recount.
  const notesByDay = new Map<string, StockLog>();
  for (const log of logs) {
    if (log.event !== "day_note" || !inRange(logDay(log), from, to)) continue;
    const held = notesByDay.get(logDay(log));
    if (!held || log.recorded_at > held.recorded_at) notesByDay.set(logDay(log), log);
  }

  const list = [...products.values()].sort(
    (a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity) || b.sold - a.sold || a.productName.localeCompare(b.productName)
  );
  return {
    from,
    to,
    through,
    products: list,
    totals: {
      revenue: round(totals.revenue, 2),
      cost: round(totals.cost, 2),
      profit: round(totals.profit, 2),
      wasteCost: round(totals.wasteCost, 2),
    },
    unpriced,
    countDays,
    notes: [...notesByDay.entries()]
      .map(([date, log]) => ({ date, tags: log.tags ?? [], note: log.note }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export type SupplierSpend = { supplier: string; total: number; deliveries: number };

// Invoice totals from the delivery log for one week, by supplier.
export function supplierSpend(
  deliveries: { supplier_name: string; invoice_total: number | null; recorded_at: string; accepted: boolean }[],
  from: string
): SupplierSpend[] {
  const to = shiftDay(from, 6);
  const bySupplier = new Map<string, SupplierSpend>();
  for (const d of deliveries) {
    const day = localDateStr(new Date(d.recorded_at));
    if (d.invoice_total == null || !d.accepted || day < from || day > to) continue;
    const name = d.supplier_name.trim();
    const entry = bySupplier.get(name.toLowerCase()) ?? { supplier: name, total: 0, deliveries: 0 };
    entry.total = round(entry.total + Number(d.invoice_total), 2);
    entry.deliveries += 1;
    bySupplier.set(name.toLowerCase(), entry);
  }
  return [...bySupplier.values()].sort((a, b) => b.total - a.total);
}
