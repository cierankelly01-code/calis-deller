import type { AmbientDisplayLogRow } from "@/types/database";
import { localDateStr } from "@/lib/counter/board";

// Sandwiches on top of the counter, derived from the append-only log: what
// is out right now (and how long it has left of its four hours), what is in
// the fridge ready to go out, and what came back chilled and must never go
// out again. All time maths is in milliseconds from ISO timestamps so the
// same helpers drive the board, the dashboard row and the alert bar.

export type AmbientLog = Pick<
  AmbientDisplayLogRow,
  | "id"
  | "client_id"
  | "staff_id"
  | "event"
  | "batch_client_id"
  | "product_id"
  | "product_name"
  | "quantity"
  | "off_by"
  | "outcome"
  | "note"
  | "recorded_at"
>;

export const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
// Two warnings before the deadline and one when it passes.
export const ALERT_STAGES = [
  { key: "30m", atMsLeft: 30 * 60 * 1000, title: "Sandwiches: 30 minutes left" },
  { key: "10m", atMsLeft: 10 * 60 * 1000, title: "Sandwiches: 10 minutes left" },
  { key: "due", atMsLeft: 0, title: "TAKE THE SANDWICHES OFF NOW" },
] as const;

export const OUTCOMES: Record<NonNullable<AmbientDisplayLogRow["outcome"]>, string> = {
  sold_out: "Sold out",
  chilled: "Back in the fridge — sell chilled",
  binned: "Binned",
};

export type OutItem = {
  clientId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  staffId: string;
};

export type OutStatus = "ok" | "soon" | "overdue";

export type OutGroup = {
  key: string; // the shared put-out timestamp
  outAt: string; // ISO
  offBy: string; // ISO — four hours after outAt
  items: OutItem[];
  quantity: number;
  msLeft: number; // negative once over
  status: OutStatus;
};

export function productKey(name: string): string {
  return name.trim().toLowerCase();
}

export function computeOffBy(outAt: Date): string {
  return new Date(outAt.getTime() + FOUR_HOURS_MS).toISOString();
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function describeRemaining(msLeft: number): string {
  const minutes = Math.ceil(Math.abs(msLeft) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const span = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  if (msLeft < 0) return `Over by ${span} — bin them`;
  if (msLeft === 0) return "Time's up — take them off";
  return `${span} left`;
}

// Every put_out with no taken_off, grouped by the moment they went out (one
// save = one timestamp = one timer), soonest deadline first.
export function outNow(logs: AmbientLog[], now: number = Date.now()): OutGroup[] {
  const takenOff = new Set<string>();
  for (const log of logs) {
    if (log.event === "taken_off" && log.batch_client_id) takenOff.add(log.batch_client_id);
  }
  const groups = new Map<string, OutGroup>();
  for (const log of logs) {
    if (log.event !== "put_out" || takenOff.has(log.client_id)) continue;
    const offBy = log.off_by ?? computeOffBy(new Date(log.recorded_at));
    const key = log.recorded_at;
    const group = groups.get(key) ?? {
      key,
      outAt: log.recorded_at,
      offBy,
      items: [],
      quantity: 0,
      msLeft: new Date(offBy).getTime() - now,
      status: "ok",
    };
    group.items.push({
      clientId: log.client_id,
      productId: log.product_id ?? null,
      productName: log.product_name,
      quantity: log.quantity,
      staffId: log.staff_id,
    });
    group.quantity += log.quantity;
    groups.set(key, group);
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.items.sort((a, b) => a.productName.localeCompare(b.productName));
    group.status = group.msLeft < 0 ? "overdue" : group.msLeft <= 30 * 60 * 1000 ? "soon" : "ok";
  }
  return list.sort((a, b) => a.offBy.localeCompare(b.offBy));
}

export type ReserveItem = { productId: string | null; productName: string; quantity: number };

// Today's made minus today's put out, per product. Sandwiches that came back
// chilled are deliberately not counted: they have used their four hours.
export function fridgeReserve(logs: AmbientLog[], today: string = localDateStr(new Date())): ReserveItem[] {
  const reserve = new Map<string, ReserveItem>();
  for (const log of logs) {
    if (localDateStr(new Date(log.recorded_at)) !== today) continue;
    if (log.event !== "made" && log.event !== "put_out") continue;
    const key = productKey(log.product_name);
    const item = reserve.get(key) ?? { productId: log.product_id, productName: log.product_name.trim(), quantity: 0 };
    item.quantity += log.event === "made" ? log.quantity : -log.quantity;
    if (!item.productId && log.product_id) item.productId = log.product_id;
    reserve.set(key, item);
  }
  return [...reserve.values()].filter((item) => item.quantity > 0).sort((a, b) => a.productName.localeCompare(b.productName));
}

export type ChilledReturn = { productName: string; quantity: number; at: string };

// Came off the counter today with some left and went back in the fridge:
// sell from the fridge, never out again.
export function chilledReturns(logs: AmbientLog[], today: string = localDateStr(new Date())): ChilledReturn[] {
  return logs
    .filter((log) => log.event === "taken_off" && log.outcome === "chilled" && log.quantity > 0 && localDateStr(new Date(log.recorded_at)) === today)
    .map((log) => ({ productName: log.product_name, quantity: log.quantity, at: log.recorded_at }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export type AmbientSummary = {
  out: number; // sandwiches on the counter
  groups: number;
  soonestMsLeft: number | null;
  overdue: number; // groups past their four hours
  inFridge: number;
};

export function summariseAmbient(groups: OutGroup[], reserve: ReserveItem[]): AmbientSummary {
  return {
    out: groups.reduce((n, g) => n + g.quantity, 0),
    groups: groups.length,
    soonestMsLeft: groups.length ? Math.min(...groups.map((g) => g.msLeft)) : null,
    overdue: groups.filter((g) => g.status === "overdue").length,
    inFridge: reserve.reduce((n, r) => n + r.quantity, 0),
  };
}

// Which alerts should fire now that haven't already. Keys are stable per
// group + stage so a reload or a second tab never repeats one.
export function dueAlerts(groups: OutGroup[], fired: Set<string>): { key: string; title: string; body: string }[] {
  const due: { key: string; title: string; body: string }[] = [];
  for (const group of groups) {
    for (const stage of ALERT_STAGES) {
      const key = `${group.key}:${stage.key}`;
      if (fired.has(key) || group.msLeft > stage.atMsLeft) continue;
      due.push({
        key,
        title: stage.title,
        body: `${group.quantity} out since ${formatClock(group.outAt)} · off by ${formatClock(group.offBy)}`,
      });
    }
  }
  return due;
}
