import type { CounterStockLogRow } from "@/types/database";

// The counter board is derived, never stored: every "put out" event that has
// no matching "taken off" event is a batch that is on the counter right now.
// Everything here is plain date arithmetic on YYYY-MM-DD strings in the
// device's local time, so the same helpers drive the put-out preview, the
// optimistic cache and the board itself.

export type CounterLog = Pick<
  CounterStockLogRow,
  | "id"
  | "client_id"
  | "staff_id"
  | "event"
  | "batch_client_id"
  | "product_id"
  | "product_name"
  | "unit_id"
  | "open_life_days"
  | "pack_use_by"
  | "discard_by"
  | "batch_code"
  | "delivery_log_id"
  | "reason"
  | "note"
  | "recorded_at"
>;

export type BatchStatus = "ok" | "today" | "overdue";

export type OpenBatch = {
  clientId: string;
  productId: string | null;
  productName: string;
  unitId: string;
  staffId: string;
  openedAt: string; // ISO timestamp of the put-out
  openLifeDays: number;
  packUseBy: string | null;
  discardBy: string; // YYYY-MM-DD — last day it may be sold
  batchCode: string | null;
  deliveryLogId: string | null;
  daysLeft: number; // 0 = last day today, negative = overdue
  status: BatchStatus;
  sellFirst: boolean; // oldest of two or more open batches of the same product
  customerDays: number; // "use within N days" — never longer than the batch has left
};

export const REASONS: Record<NonNullable<CounterStockLogRow["reason"]>, string> = {
  sold_out: "Sold out",
  end_of_life: "End of life — binned",
  quality: "Quality — binned",
  other: "Other",
};

export function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

// Whole days from `from` to `to` (both YYYY-MM-DD); noon anchors sidestep DST.
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// "3 days" means the day it was opened plus two more, and a shorter pack
// use-by always wins. Same rule as the database trigger, for the preview and
// for entries still queued on the device.
export function computeDiscardBy(openedAt: Date, openLifeDays: number, packUseBy: string | null): string {
  const byLife = addDays(localDateStr(openedAt), openLifeDays - 1);
  return packUseBy && packUseBy < byLife ? packUseBy : byLife;
}

export function formatDay(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function describeDaysLeft(daysLeft: number): string {
  if (daysLeft < -1) return `${-daysLeft} days overdue`;
  if (daysLeft === -1) return "1 day overdue";
  if (daysLeft === 0) return "Last day — bin tonight";
  if (daysLeft === 1) return "Bin tomorrow night";
  return `${daysLeft} days left`;
}

export function customerAdvice(customerDays: number): string {
  return customerDays <= 1 ? "Use today" : `Use within ${customerDays} days`;
}

export function openBatches(logs: CounterLog[], today: string = localDateStr(new Date())): OpenBatch[] {
  const takenOff = new Set<string>();
  for (const log of logs) {
    if (log.event === "taken_off" && log.batch_client_id) takenOff.add(log.batch_client_id);
  }

  const batches: OpenBatch[] = [];
  for (const log of logs) {
    if (log.event !== "put_out" || takenOff.has(log.client_id)) continue;
    const openLifeDays = log.open_life_days ?? 3;
    const discardBy = log.discard_by ?? computeDiscardBy(new Date(log.recorded_at), openLifeDays, log.pack_use_by);
    const daysLeft = daysBetween(today, discardBy);
    batches.push({
      clientId: log.client_id,
      productId: log.product_id,
      productName: log.product_name,
      unitId: log.unit_id,
      staffId: log.staff_id,
      openedAt: log.recorded_at,
      openLifeDays,
      packUseBy: log.pack_use_by,
      discardBy,
      batchCode: log.batch_code,
      deliveryLogId: log.delivery_log_id,
      daysLeft,
      status: daysLeft < 0 ? "overdue" : daysLeft === 0 ? "today" : "ok",
      sellFirst: false,
      customerDays: Math.max(1, Math.min(openLifeDays, daysLeft + 1)),
    });
  }

  // Soonest to bin first; ties broken by which went out first.
  batches.sort((a, b) => a.discardBy.localeCompare(b.discardBy) || a.openedAt.localeCompare(b.openedAt));

  // First-in-first-out: when the same product is out twice, the older one is
  // the one to sell from — that's the "new ham goes underneath" rule made visible.
  const seen = new Set<string>();
  for (const batch of batches) {
    const key = batch.productName.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (batches.some((other) => other !== batch && other.productName.trim().toLowerCase() === key)) {
      batch.sellFirst = true;
    }
  }
  return batches;
}

export type CounterSummary = { open: number; dueToday: number; overdue: number };

export function summarise(batches: OpenBatch[]): CounterSummary {
  return {
    open: batches.length,
    dueToday: batches.filter((b) => b.status === "today").length,
    overdue: batches.filter((b) => b.status === "overdue").length,
  };
}

// "Prove it" numbers for the last N days — what an EHO (and the owner) can
// read off the board without opening a spreadsheet: how much went out, how
// much sold through, how much was binned, and whether anything sat past its
// date before it was taken off.
export type RotationStats = {
  days: number;
  putOut: number;
  soldOut: number;
  binnedInDate: number;
  binnedLate: number; // taken off after its bin-by date — the number to keep at zero
};

export function rotationStats(logs: CounterLog[], today: string = localDateStr(new Date()), days = 28): RotationStats {
  const since = addDays(today, -(days - 1));
  const batches = new Map<string, CounterLog>();
  for (const log of logs) if (log.event === "put_out") batches.set(log.client_id, log);
  const stats: RotationStats = { days, putOut: 0, soldOut: 0, binnedInDate: 0, binnedLate: 0 };
  for (const log of logs) {
    const day = localDateStr(new Date(log.recorded_at));
    if (day < since) continue;
    if (log.event === "put_out") {
      stats.putOut += 1;
      continue;
    }
    if (log.reason === "sold_out") {
      stats.soldOut += 1;
      continue;
    }
    const batch = log.batch_client_id ? batches.get(log.batch_client_id) : undefined;
    const discardBy = batch
      ? batch.discard_by ?? computeDiscardBy(new Date(batch.recorded_at), batch.open_life_days ?? 3, batch.pack_use_by)
      : null;
    if (discardBy && day > discardBy) stats.binnedLate += 1;
    else stats.binnedInDate += 1;
  }
  return stats;
}
