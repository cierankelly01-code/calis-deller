"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { HowLink } from "@/components/ui/HowLink";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchHotBatches } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { describeRemaining, formatClock } from "@/lib/ambient/board";
import { CHILLED_MAX_C, COOLING_OUTCOMES, coolingRate, finished, onTheClock, type CoolingBatch, type HotBatchLog } from "@/lib/cooling/board";

// The cooling clock: every warm batch on the side, how long it has left of
// its two hours, its probe readings, and one tap to say where it went.
// Batches start from the hot food check (cooked to 75°C+).

type Outcome = keyof typeof COOLING_OUTCOMES;
type Action = { clientId: string; kind: "probe" } | { clientId: string; kind: "done"; outcome: Outcome };

const STYLE = {
  ok: { card: "bg-surface border-line", big: "text-brand-deep" },
  soon: { card: "bg-gold-soft border-gold/50", big: "text-gold-deep" },
  overdue: { card: "bg-danger-soft border-danger/40", big: "text-danger" },
} as const;

export default function CoolingPage() {
  const { site } = useSite();
  const cacheKey = `cd-hot-batches:${site.id}`;
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: logs, loading } = useCachedQuery(cacheKey, () => fetchHotBatches(site.id));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [localLogs, setLocalLogs] = useState<HotBatchLog[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [action, setAction] = useState<Action | null>(null);
  const [temp, setTemp] = useState("");
  const [left, setLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const all = useMemo(() => {
    const seen = new Set((logs ?? []).map((l) => l.client_id));
    return [...localLogs.filter((l) => !seen.has(l.client_id)), ...(logs ?? [])];
  }, [logs, localLogs]);
  const batches = useMemo(() => onTheClock(all, now), [all, now]);
  const done = useMemo(() => finished(all).filter((b) => new Date(b.doneAt).toDateString() === new Date(now).toDateString()), [all, now]);
  const name = (id: string) => (staff ?? []).find((s) => s.id === id)?.name ?? "";

  function start(next: Action, batch: CoolingBatch) {
    setAction(next);
    setTemp("");
    setLeft(next.kind === "done" && next.outcome === "sold_out" ? 0 : batch.quantity);
    setError(null);
  }

  async function save(batch: CoolingBatch) {
    if (!action || !staffId) return;
    const numeric = temp === "" || temp === "-" ? null : parseFloat(temp);
    if (action.kind === "probe" && numeric === null) return;
    setSaving(true);
    setError(null);
    try {
      const row = {
        staff_id: staffId,
        event: action.kind,
        batch_client_id: batch.clientId,
        product_id: batch.productId,
        product_name: batch.productName,
        quantity: action.kind === "done" ? left : null,
        temp_c: numeric,
        outcome: action.kind === "done" ? action.outcome : null,
        recorded_at: new Date().toISOString(),
      };
      const clientId = await queueEntry("hot_batch_logs", row);
      const saved = { id: clientId, client_id: clientId, cooking_client_id: null, due_by: null, note: null, ...row } as HotBatchLog;
      setLocalLogs((l) => [saved, ...l]);
      appendToTodayCache(cacheKey, saved);
      void syncOutbox().catch(() => {});
      setAction(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Cooling clock" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        <div className="rounded-2xl bg-ink text-paper px-5 py-4">
          <p className="font-bold text-lg">2 hours from the oven</p>
          <p className="mt-1 text-sm text-paper/75">Cool them in the coolest spot, spread out. Within 2 hours: into the chilled counter (8°C or below), sold, or binned. Never longer.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/log/cooking" className="inline-flex h-11 items-center rounded-full bg-gold px-4 font-bold text-ink">+ Out of the oven</Link>
            <HowLink method="chilling-down" />
          </div>
        </div>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Who&apos;s checking?</h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">On the clock now</h2>
          {loading && batches.length === 0 && <p className="text-ink-faint">Loading…</p>}
          {!loading && batches.length === 0 && (
            <p className="rounded-2xl bg-surface border border-line p-4 text-ink-soft">Nothing cooling. When a batch comes out of the oven, do a hot food check and leave “Start the 2-hour clock” on.</p>
          )}
          <div className="space-y-3">
            {batches.map((batch) => {
              const style = STYLE[batch.status];
              const rate = coolingRate(batch.probes);
              const open = action?.clientId === batch.clientId ? action : null;
              return (
                <article key={batch.clientId} className={`rounded-2xl border-2 px-4 py-4 ${style.card}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-ink">{batch.quantity} × {batch.productName}</p>
                      <p className="text-sm text-ink-soft">Out of the oven {formatClock(batch.outAt)}{name(batch.staffId) && ` · ${name(batch.staffId)}`}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold tabular-nums ${style.big}`}>{describeRemaining(batch.msLeft)}</p>
                      <p className="text-sm text-ink-soft">by {formatClock(batch.dueBy)}</p>
                    </div>
                  </div>
                  {batch.status === "overdue" && <p className="mt-2 font-bold text-danger" role="alert">Over 2 hours: bin them now.</p>}
                  {batch.probes.length > 0 && (
                    <p className="mt-2 text-sm text-ink">
                      Probed: {batch.probes.map((p) => `${p.temp}°C at ${formatClock(p.at)}`).join(" · ")}
                      {rate !== null && <span className="text-ink-soft"> · cooling {rate}°C every 15 min</span>}
                    </p>
                  )}
                  {!open && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" disabled={!staffId} onClick={() => start({ clientId: batch.clientId, kind: "probe" }, batch)} className="h-12 rounded-xl bg-surface border border-line font-semibold disabled:opacity-40">🌡️ Probe it</button>
                      <button type="button" disabled={!staffId} onClick={() => start({ clientId: batch.clientId, kind: "done", outcome: "chilled" }, batch)} className="h-12 rounded-xl bg-brand text-white font-semibold disabled:opacity-40">❄️ Into chilled counter</button>
                      <button type="button" disabled={!staffId} onClick={() => start({ clientId: batch.clientId, kind: "done", outcome: "sold_out" }, batch)} className="h-12 rounded-xl bg-surface border border-line font-semibold disabled:opacity-40">✓ All sold</button>
                      <button type="button" disabled={!staffId} onClick={() => start({ clientId: batch.clientId, kind: "done", outcome: "binned" }, batch)} className="h-12 rounded-xl bg-surface border border-danger/30 text-danger font-semibold disabled:opacity-40">🗑 Binned</button>
                    </div>
                  )}
                  {!staffId && !open && <p className="mt-2 text-sm text-ink-soft">Tap your name above first.</p>}
                  {open && (
                    <div className="mt-4 space-y-3">
                      {open.kind === "probe" ? (
                        <>
                          <p className="font-semibold">Temperature now (probe the middle of one)</p>
                          <NumberPad value={temp} onChange={setTemp} suffix="°C" />
                        </>
                      ) : (
                        <>
                          <p className="font-semibold">{COOLING_OUTCOMES[open.outcome]}{open.outcome !== "sold_out" && ": how many?"}</p>
                          {open.outcome !== "sold_out" && (
                            <div className="flex items-center justify-center gap-3">
                              <button type="button" onClick={() => setLeft((n) => Math.max(0, n - 1))} className="h-14 w-14 rounded-2xl bg-surface border border-line text-2xl font-bold" aria-label="Fewer">−</button>
                              <div className="h-14 w-24 flex items-center justify-center rounded-2xl bg-ink text-paper text-3xl font-mono tabular-nums">{left}</div>
                              <button type="button" onClick={() => setLeft((n) => Math.min(10000, n + 1))} className="h-14 w-14 rounded-2xl bg-surface border border-line text-2xl font-bold" aria-label="More">+</button>
                            </div>
                          )}
                          {open.outcome === "chilled" && (
                            <>
                              {batch.status === "overdue" && <p className="text-danger font-semibold">These are over 2 hours: the safe choice is the bin.</p>}
                              <p className="text-sm text-ink-soft">Optional: probe one before it goes in. The chilled counter must keep it at {CHILLED_MAX_C}°C or below.</p>
                              <NumberPad value={temp} onChange={setTemp} suffix="°C" />
                            </>
                          )}
                        </>
                      )}
                      {error && <p role="alert" className="text-danger">{error}</p>}
                      <div className="flex gap-2">
                        <button type="button" disabled={saving || (open.kind === "probe" && (temp === "" || temp === "-"))} onClick={() => save(batch)} className="flex-1 h-14 rounded-2xl bg-brand text-white text-lg font-bold disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
                        <button type="button" onClick={() => setAction(null)} className="h-14 rounded-2xl border border-line px-5">Cancel</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {done.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Finished today</h2>
            <div className="space-y-2">
              {done.map((b) => (
                <div key={b.clientId} className={`rounded-2xl border px-4 py-3 text-sm ${b.lateBy > 0 ? "bg-danger-soft border-danger/30" : "bg-surface border-line"}`}>
                  <span className="font-semibold">{b.quantity} × {b.productName}</span> · out {formatClock(b.outAt)} → {COOLING_OUTCOMES[b.outcome].toLowerCase()} {formatClock(b.doneAt)}
                  {b.outcome !== "sold_out" && ` (${b.left})`}
                  {b.lateBy > 0 && <span className="block text-danger font-semibold">Finished {describeRemaining(-b.lateBy).replace("Over by ", "")} after the 2 hours</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
