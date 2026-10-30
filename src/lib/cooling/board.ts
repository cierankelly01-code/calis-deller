import type { HotBatchLogRow } from "@/types/database";

// The cooling clock, derived from the append-only log. A cooked batch sold
// warm off the side (sausage rolls) has two hours from coming out of the
// oven — FSA SFBB hot holding: food out of hot holding may be displayed for
// up to two hours, once. By then it goes into the chilled counter (8°C or
// below), has sold out, or is binned. Probes along the way are the "prove
// it" record of how fast it really cools.

export type HotBatchLog = Pick<
  HotBatchLogRow,
  | "id"
  | "client_id"
  | "staff_id"
  | "event"
  | "batch_client_id"
  | "cooking_client_id"
  | "product_id"
  | "product_name"
  | "quantity"
  | "temp_c"
  | "due_by"
  | "outcome"
  | "note"
  | "recorded_at"
>;

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
export const CHILLED_MAX_C = 8;

export const COOLING_OUTCOMES: Record<NonNullable<HotBatchLogRow["outcome"]>, string> = {
  chilled: "Into the chilled counter",
  sold_out: "All sold",
  binned: "Binned",
};

export const COOLING_ALERT_STAGES = [
  { key: "30m", atMsLeft: 30 * 60 * 1000, title: "Cooling clock: 30 minutes left" },
  { key: "due", atMsLeft: 0, title: "2 HOURS UP: chill or bin them now" },
] as const;

export type CoolingStatus = "ok" | "soon" | "overdue";

export type Probe = { temp: number; at: string; staffId: string };

export type CoolingBatch = {
  clientId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  staffId: string;
  outAt: string;
  dueBy: string;
  msLeft: number;
  status: CoolingStatus;
  probes: Probe[]; // oldest first
};

export function computeDueBy(outAt: Date): string {
  return new Date(outAt.getTime() + TWO_HOURS_MS).toISOString();
}

function probesFor(logs: HotBatchLog[], clientId: string): Probe[] {
  return logs
    .filter((l) => l.event === "probe" && l.batch_client_id === clientId && l.temp_c != null)
    .map((l) => ({ temp: Number(l.temp_c), at: l.recorded_at, staffId: l.staff_id }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Batches still on the clock, soonest deadline first.
export function onTheClock(logs: HotBatchLog[], now: number = Date.now()): CoolingBatch[] {
  const closed = new Set(logs.filter((l) => l.event === "done" && l.batch_client_id).map((l) => l.batch_client_id));
  return logs
    .filter((l) => l.event === "out" && !closed.has(l.client_id))
    .map((l) => {
      // A queued entry has no server due_by yet: show the deadline it will get.
      const dueBy = l.due_by ?? computeDueBy(new Date(l.recorded_at));
      const msLeft = Date.parse(dueBy) - now;
      const status: CoolingStatus = msLeft <= 0 ? "overdue" : msLeft <= 30 * 60 * 1000 ? "soon" : "ok";
      return {
        clientId: l.client_id,
        productId: l.product_id,
        productName: l.product_name,
        quantity: l.quantity ?? 0,
        staffId: l.staff_id,
        outAt: l.recorded_at,
        dueBy,
        msLeft,
        status,
        probes: probesFor(logs, l.client_id),
      };
    })
    .sort((a, b) => a.dueBy.localeCompare(b.dueBy));
}

export type FinishedBatch = CoolingBatch & { outcome: NonNullable<HotBatchLogRow["outcome"]>; doneAt: string; left: number; lateBy: number };

// Finished batches, newest first: the record an inspector traces.
export function finished(logs: HotBatchLog[]): FinishedBatch[] {
  const outs = new Map(logs.filter((l) => l.event === "out").map((l) => [l.client_id, l]));
  return logs
    .filter((l) => l.event === "done" && l.batch_client_id && outs.has(l.batch_client_id) && l.outcome)
    .map((done) => {
      const out = outs.get(done.batch_client_id!)!;
      const dueBy = out.due_by ?? computeDueBy(new Date(out.recorded_at));
      return {
        clientId: out.client_id,
        productId: out.product_id,
        productName: out.product_name,
        quantity: out.quantity ?? 0,
        staffId: out.staff_id,
        outAt: out.recorded_at,
        dueBy,
        msLeft: Date.parse(dueBy) - Date.parse(done.recorded_at),
        status: "ok" as CoolingStatus,
        probes: probesFor(logs, out.client_id),
        outcome: done.outcome!,
        doneAt: done.recorded_at,
        left: done.quantity ?? 0,
        lateBy: Math.max(0, Date.parse(done.recorded_at) - Date.parse(dueBy)),
      };
    })
    .sort((a, b) => b.doneAt.localeCompare(a.doneAt));
}

export type CoolingSummary = { onClock: number; soon: number; overdue: number; soonestMsLeft: number | null };

export function summariseCooling(batches: CoolingBatch[]): CoolingSummary {
  return {
    onClock: batches.length,
    soon: batches.filter((b) => b.status === "soon").length,
    overdue: batches.filter((b) => b.status === "overdue").length,
    soonestMsLeft: batches.length ? batches[0].msLeft : null,
  };
}

export function coolingAlerts(batches: CoolingBatch[], fired: Set<string>): { key: string; title: string; body: string }[] {
  const due: { key: string; title: string; body: string }[] = [];
  for (const batch of batches) {
    for (const stage of COOLING_ALERT_STAGES) {
      const key = `${batch.clientId}:${stage.key}`;
      if (batch.msLeft <= stage.atMsLeft && !fired.has(key)) {
        due.push({ key, title: stage.title, body: `${batch.quantity} × ${batch.productName}` });
      }
    }
  }
  return due;
}

// "Prove it": how fast did it cool, in °C per 15 minutes, from the first
// probe to the last. Null with fewer than two probes.
export function coolingRate(probes: Probe[]): number | null {
  if (probes.length < 2) return null;
  const first = probes[0], last = probes[probes.length - 1];
  const minutes = (Date.parse(last.at) - Date.parse(first.at)) / 60_000;
  if (minutes <= 0) return null;
  return Math.round(((first.temp - last.temp) / minutes) * 15 * 10) / 10;
}

// Finishing entries ("done") made after their batch's two hours: the diary,
// the export and the inspector page flag these. Batches whose 'out' isn't in
// the rows given can't be judged and are left unflagged.
export function lateFinishes(rows: Pick<HotBatchLog, "id" | "client_id" | "event" | "batch_client_id" | "due_by" | "recorded_at">[]): Set<string> {
  const dueBy = new Map(rows.filter((r) => r.event === "out").map((r) => [r.client_id, r.due_by ?? computeDueBy(new Date(r.recorded_at))]));
  const late = new Set<string>();
  for (const r of rows) {
    const due = r.event === "done" && r.batch_client_id ? dueBy.get(r.batch_client_id) : undefined;
    if (due && Date.parse(r.recorded_at) > Date.parse(due)) late.add(r.id);
  }
  return late;
}
