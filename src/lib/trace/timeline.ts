import type { AmbientDisplayLogRow, CookingLogRow, CounterStockLogRow, DeliveryLogRow, HotBatchLogRow } from "@/types/database";
import { COOLING_OUTCOMES } from "@/lib/cooling/board";

// "Someone was ill after a sausage roll from Thursday." Trace pulls every
// record for a product across the days asked for, in time order: cooked at
// what temperature, how it cooled, when it went into the counter, how it
// left. Matching is by product name (case-insensitive, contains), because
// typed-in names are captured on every record and survive product edits.

export type TraceEvent = {
  at: string;
  kind: "delivery" | "cooking" | "cooling" | "counter" | "sandwich";
  title: string;
  detail: string;
  staffId: string;
  flag: boolean; // out of range / over time / binned for quality
};

export type TraceInput = {
  cooking: CookingLogRow[];
  hotBatches: HotBatchLogRow[];
  counter: CounterStockLogRow[];
  ambient: AmbientDisplayLogRow[];
  deliveries: DeliveryLogRow[];
  deliveryLabels: Map<string, string>;
};

const CHECK_LABEL = { cooking: "Cooked", reheating: "Reheated", hot_hold: "Hot-hold check" } as const;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function buildTrace(input: TraceInput, product: string): TraceEvent[] {
  const q = product.trim().toLowerCase();
  const hit = (name: string | null | undefined) => !!name && (q === "" || name.toLowerCase().includes(q));
  const events: TraceEvent[] = [];

  for (const c of input.cooking.filter((r) => hit(r.product_name))) {
    events.push({ at: c.recorded_at, kind: "cooking", title: `${CHECK_LABEL[c.check_type]}: ${c.quantity} × ${c.product_name}`, detail: `Core ${c.temp_c}°C${c.in_range ? " ✓" : ` (below target). Action: ${c.corrective_action ?? ""}`}`, staffId: c.staff_id, flag: !c.in_range });
  }

  const outs = new Map(input.hotBatches.filter((b) => b.event === "out").map((b) => [b.client_id, b]));
  for (const b of input.hotBatches.filter((r) => hit(r.product_name))) {
    if (b.event === "out") {
      events.push({ at: b.recorded_at, kind: "cooling", title: `Cooling clock started: ${b.quantity} × ${b.product_name}`, detail: b.due_by ? `Chill, sell or bin by ${clock(b.due_by)}` : "2 hours to chill, sell or bin", staffId: b.staff_id, flag: false });
    } else if (b.event === "probe") {
      events.push({ at: b.recorded_at, kind: "cooling", title: `Probed while cooling: ${b.product_name}`, detail: `${b.temp_c}°C`, staffId: b.staff_id, flag: false });
    } else {
      const out = b.batch_client_id ? outs.get(b.batch_client_id) : undefined;
      const late = out?.due_by ? Date.parse(b.recorded_at) > Date.parse(out.due_by) : false;
      events.push({ at: b.recorded_at, kind: "cooling", title: `${COOLING_OUTCOMES[b.outcome!]}: ${b.product_name}`, detail: `${b.outcome === "sold_out" ? "none left" : `${b.quantity} left`}${b.temp_c != null ? ` · ${b.temp_c}°C` : ""}${late ? " · AFTER the 2 hours" : ""}`, staffId: b.staff_id, flag: late });
    }
  }

  for (const c of input.counter.filter((r) => hit(r.product_name))) {
    if (c.event === "put_out") {
      const from = c.delivery_log_id ? input.deliveryLabels.get(c.delivery_log_id) : null;
      events.push({ at: c.recorded_at, kind: "counter", title: `Into the counter: ${c.product_name}`, detail: [c.discard_by && `bin by ${c.discard_by}`, c.batch_code && `batch ${c.batch_code}`, from && `from ${from}`].filter(Boolean).join(" · "), staffId: c.staff_id, flag: false });
    } else {
      events.push({ at: c.recorded_at, kind: "counter", title: `Off the counter: ${c.product_name}`, detail: `${c.reason?.replace(/_/g, " ") ?? ""}${c.note ? `: ${c.note}` : ""}`, staffId: c.staff_id, flag: c.reason === "quality" });
    }
  }

  for (const a of input.ambient.filter((r) => hit(r.product_name))) {
    const what = a.event === "made" ? "Made" : a.event === "put_out" ? "Put out on the counter" : "Taken off the counter";
    events.push({ at: a.recorded_at, kind: "sandwich", title: `${what}: ${a.quantity} × ${a.product_name}`, detail: a.off_by ? `off by ${clock(a.off_by)}` : a.outcome ? a.outcome.replace(/_/g, " ") : "", staffId: a.staff_id, flag: false });
  }

  // Deliveries carry no product lines: show the ones linked from this
  // product's counter batches, so "where did it come from" is answered.
  const linked = new Set(input.counter.filter((r) => hit(r.product_name) && r.delivery_log_id).map((r) => r.delivery_log_id));
  for (const d of input.deliveries.filter((r) => linked.has(r.id))) {
    events.push({ at: d.recorded_at, kind: "delivery", title: `Delivery: ${d.supplier_name}`, detail: [d.chilled_temp_c != null && `chilled ${d.chilled_temp_c}°C`, d.accepted ? "accepted" : `rejected: ${d.rejection_reason ?? ""}`].filter(Boolean).join(" · "), staffId: d.staff_id, flag: !d.accepted });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
