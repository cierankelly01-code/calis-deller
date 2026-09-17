"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchAmbientDisplay } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import {
  OUTCOMES,
  chilledReturns,
  describeRemaining,
  formatClock,
  fridgeReserve,
  outNow,
  summariseAmbient,
  type AmbientLog,
  type OutGroup,
} from "@/lib/ambient/board";
import { alertsEnabled, alertsSupported, disableAlerts, enableAlerts, subscribeAlerts } from "@/lib/ambient/alerts";
import type { AmbientDisplayLogRow } from "@/types/database";

// The sandwich counter: a live countdown for everything on top (the
// four-hour rule), what's in the fridge ready to go up next, and what came
// back chilled and must never go up again. Taking a batch off asks, per
// sandwich type, what happened and how many were left — that's the record
// an EHO wants, and it's where the "once only" rule is enforced.

type Outcome = NonNullable<AmbientDisplayLogRow["outcome"]>;
type Closing = { groupKey: string; lines: Record<string, { outcome: Outcome | null; left: number }> };

const STATUS_STYLE = {
  ok: { card: "bg-surface border-line", big: "text-brand-deep", pill: "bg-brand-soft text-brand-deep" },
  soon: { card: "bg-gold-soft border-gold/50", big: "text-gold-deep", pill: "bg-gold text-ink" },
  overdue: { card: "bg-danger-soft border-danger/40", big: "text-danger", pill: "bg-danger text-white" },
} as const;

export default function SandwichBoardPage() {
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: logs, loading, error } = useCachedQuery(`cd-ambient:${site.id}`, () => fetchAmbientDisplay(site.id));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);

  const [localLogs, setLocalLogs] = useState<AmbientLog[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [closing, setClosing] = useState<Closing | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Read straight from the device setting (SSR renders "off", the client
  // repaints after hydration); enable/disable announce changes via an event.
  const alertsOn = useSyncExternalStore(subscribeAlerts, alertsEnabled, () => false);
  const alertsAvailable = useSyncExternalStore(subscribeAlerts, alertsSupported, () => false);

  // Countdown tick. The deadline is fixed server-side; only "now" moves.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const all = useMemo(() => {
    const byId = new Map<string, AmbientLog>();
    for (const log of [...localLogs, ...(logs ?? [])]) byId.set(log.client_id, log);
    return [...byId.values()];
  }, [localLogs, logs]);
  const groups = useMemo(() => outNow(all, now), [all, now]);
  const reserve = useMemo(() => fridgeReserve(all), [all]);
  const returns = useMemo(() => chilledReturns(all), [all]);
  const summary = summariseAmbient(groups, reserve);
  const staffName = (id: string) => staff?.find((s) => s.id === id)?.name ?? "staff";

  function startClosing(group: OutGroup) {
    setSaveError(null);
    if (closing?.groupKey === group.key) {
      setClosing(null);
      return;
    }
    const lines: Closing["lines"] = {};
    for (const item of group.items) {
      // Over the four hours: the only lawful outcome for what's left is the bin.
      lines[item.clientId] = { outcome: group.status === "overdue" ? "binned" : null, left: 0 };
    }
    setClosing({ groupKey: group.key, lines });
  }

  function setLine(clientId: string, patch: Partial<{ outcome: Outcome | null; left: number }>) {
    setClosing((current) => {
      if (!current) return current;
      const line = { ...current.lines[clientId], ...patch };
      if (line.outcome === "sold_out") line.left = 0;
      return { ...current, lines: { ...current.lines, [clientId]: line } };
    });
  }

  const closingComplete = (group: OutGroup) =>
    !!closing &&
    group.items.every((item) => {
      const line = closing.lines[item.clientId];
      return line && line.outcome !== null && (line.outcome === "sold_out" || line.left > 0 || line.outcome === "binned");
    });

  async function confirmTakenOff(group: OutGroup) {
    if (!closing || !staffId || saving || !closingComplete(group)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const recordedAt = new Date().toISOString();
      const rows: AmbientLog[] = [];
      for (const item of group.items) {
        const line = closing.lines[item.clientId];
        const payload = {
          staff_id: staffId,
          event: "taken_off" as const,
          batch_client_id: item.clientId,
          product_id: item.productId ?? null,
          product_name: item.productName,
          quantity: line.outcome === "sold_out" ? 0 : line.left,
          outcome: line.outcome!,
          note: null,
          recorded_at: recordedAt,
        };
        const clientId = await queueEntry("ambient_display_logs", payload);
        rows.push({ ...payload, id: clientId, client_id: clientId, off_by: null });
      }
      for (const row of rows) appendToTodayCache(`cd-ambient:${site.id}`, row);
      setLocalLogs((list) => [...rows, ...list]);
      window.dispatchEvent(new Event("ambient-changed"));
      void syncOutbox().catch(() => {});
      setClosing(null);
    } catch (err) {
      setSaveError(
        `Could not save on this device: ${err instanceof Error ? err.message : "unknown error"}. Check the device time and available storage, then retry.`
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleAlerts() {
    if (alertsOn) disableAlerts();
    else await enableAlerts();
  }

  const headline =
    summary.overdue > 0
      ? "Over the four hours — take them off and bin what's left"
      : summary.groups > 0 && summary.soonestMsLeft !== null
        ? describeRemaining(summary.soonestMsLeft)
        : summary.inFridge > 0
          ? `${summary.inFridge} in the fridge, nothing out`
          : "Nothing out, nothing in the fridge";

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Sandwiches" />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-6 max-w-2xl w-full mx-auto">
        <section
          className={`rounded-2xl px-5 py-4 shadow-sm ${
            summary.overdue > 0 ? "bg-danger text-white" : summary.soonestMsLeft !== null && summary.soonestMsLeft <= 30 * 60 * 1000 ? "bg-gold text-ink" : "bg-ink text-paper"
          }`}
        >
          <p className="text-xs uppercase tracking-[0.18em] font-bold opacity-70">On top of the counter</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{headline}</p>
          <p className="mt-1 text-sm opacity-75">
            {summary.out} out · {summary.inFridge} in the fridge ready to go · four hours at room temperature, once only
          </p>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/log/sandwiches?mode=made"
            className="rounded-2xl bg-surface border border-line shadow-sm p-4 active:scale-[0.98] transition-transform"
          >
            <span className="text-2xl" aria-hidden>🧊</span>
            <span className="block mt-1.5 font-bold text-ink">Made a batch</span>
            <span className="block text-[13px] text-ink-soft">into the fridge</span>
          </Link>
          <Link
            href="/log/sandwiches?mode=put_out"
            className="rounded-2xl bg-brand text-white shadow-sm p-4 active:scale-[0.98] transition-transform"
          >
            <span className="text-2xl" aria-hidden>☀️</span>
            <span className="block mt-1.5 font-bold">Put out on top</span>
            <span className="block text-[13px] text-white/75">starts the 4-hour clock</span>
          </Link>
        </div>

        {alertsAvailable && (
          <button
            type="button"
            onClick={toggleAlerts}
            className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 text-left ${
              alertsOn ? "bg-brand-soft border-brand/30" : "bg-surface border-line"
            }`}
          >
            <span>
              <span className="block font-semibold text-ink">{alertsOn ? "🔔 Alerts on for this iPad" : "🔕 Turn on alerts on this iPad"}</span>
              <span className="block text-xs text-ink-soft">
                Chime + notification at 30 min, 10 min and when time&apos;s up — while the app is open.
              </span>
            </span>
            <span className="text-sm font-semibold text-brand shrink-0">{alertsOn ? "Turn off" : "Turn on"}</span>
          </button>
        )}

        {loading && all.length === 0 && <p className="text-ink-faint">Loading…</p>}
        {error && all.length === 0 && <p className="text-danger font-medium">{error}</p>}

        {groups.map((group) => {
          const style = STATUS_STYLE[group.status];
          const isClosing = closing?.groupKey === group.key;
          return (
            <section key={group.key} className={`rounded-2xl border shadow-sm px-4 py-4 ${style.card}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider font-bold text-ink-soft">
                    Out since {formatClock(group.outAt)} · {staffName(group.items[0].staffId)}
                  </p>
                  <p className={`mt-0.5 text-3xl font-bold tabular-nums ${style.big}`}>{describeRemaining(group.msLeft)}</p>
                  <p className="text-sm text-ink-soft">Off the counter by <span className="font-semibold text-ink">{formatClock(group.offBy)}</span></p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${style.pill}`}>{group.quantity} out</span>
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <li key={item.clientId} className="rounded-full bg-paper border border-line px-3 py-1 text-sm font-semibold text-ink">
                    {item.quantity} × {item.productName}
                  </li>
                ))}
              </ul>

              {!isClosing ? (
                <button
                  type="button"
                  onClick={() => startClosing(group)}
                  className={`mt-3 h-12 w-full rounded-xl font-bold active:scale-[0.99] ${
                    group.status === "overdue" ? "bg-danger text-white" : "bg-ink text-paper"
                  }`}
                >
                  {group.status === "overdue" ? "Take off now — bin what's left" : "Take them off"}
                </button>
              ) : (
                <div className="mt-3 space-y-3 rounded-xl bg-paper border border-line p-3">
                  {group.status === "overdue" && (
                    <p className="text-sm font-semibold text-danger">
                      Over four hours at room temperature: anything left must be binned — it can&apos;t be chilled and sold.
                    </p>
                  )}
                  {group.items.map((item) => {
                    const line = closing!.lines[item.clientId];
                    return (
                      <div key={item.clientId} className="rounded-xl bg-surface border border-line p-3 space-y-2">
                        <p className="font-semibold text-ink">{item.quantity} × {item.productName}</p>
                        <div className="grid grid-cols-3 gap-2">
                          {(Object.keys(OUTCOMES) as Outcome[]).map((key) => {
                            const disabled = key === "chilled" && group.status === "overdue";
                            return (
                              <button
                                key={key}
                                type="button"
                                disabled={disabled}
                                onClick={() => setLine(item.clientId, { outcome: key, left: key === "sold_out" ? 0 : Math.max(1, line.left) })}
                                className={`min-h-12 rounded-xl px-2 text-xs font-semibold transition-all active:scale-95 disabled:opacity-30 ${
                                  line.outcome === key ? "bg-ink text-paper shadow-sm" : "bg-paper text-ink border border-line"
                                }`}
                              >
                                {key === "sold_out" ? "Sold out" : key === "chilled" ? "Back in fridge" : "Binned"}
                              </button>
                            );
                          })}
                        </div>
                        {line.outcome && line.outcome !== "sold_out" && (
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-ink-soft">How many left?</p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setLine(item.clientId, { left: Math.max(0, line.left - 1) })}
                                className="h-11 w-11 rounded-xl bg-paper border border-line text-lg font-bold active:scale-95"
                                aria-label="Fewer left"
                              >
                                −
                              </button>
                              <span className="w-10 text-center text-xl font-mono tabular-nums">{line.left}</span>
                              <button
                                type="button"
                                onClick={() => setLine(item.clientId, { left: Math.min(item.quantity, line.left + 1) })}
                                className="h-11 w-11 rounded-xl bg-paper border border-line text-lg font-bold active:scale-95"
                                aria-label="More left"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">Who&apos;s taking them off?</p>
                  <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setClosing(null)}
                      className="flex-1 h-12 rounded-xl bg-surface border border-line text-ink-soft font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!staffId || saving || !closingComplete(group)}
                      onClick={() => confirmTakenOff(group)}
                      className="flex-[2] h-12 rounded-xl bg-brand text-white font-bold active:bg-brand-deep disabled:opacity-40"
                    >
                      {saving ? "Saving…" : "Confirm taken off"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            🧊 In the fridge — ready to go out <span className="text-ink-faint">({summary.inFridge})</span>
          </h2>
          {reserve.length === 0 ? (
            <p className="text-sm text-ink-soft rounded-2xl bg-surface border border-line p-4">
              Nothing logged in the fridge today. Tap “Made a batch” when the morning sandwiches are done.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {reserve.map((item) => (
                <span key={item.productName} className="rounded-full bg-surface border border-line px-3 py-1.5 text-sm font-semibold text-ink">
                  {item.quantity} × {item.productName}
                </span>
              ))}
            </div>
          )}
        </section>

        {returns.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
              ❄️ Back in the fridge — sell chilled, never out again
            </h2>
            <div className="flex flex-wrap gap-2">
              {returns.map((item, i) => (
                <span key={`${item.at}-${i}`} className="rounded-full bg-gold-soft border border-gold/50 px-3 py-1.5 text-sm font-semibold text-gold-deep">
                  {item.quantity} × {item.productName} · off at {formatClock(item.at)}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              These have had their four hours. Sell them from the fridge or serve-over today; they can&apos;t go back on top.
            </p>
          </section>
        )}

        <p className="text-xs text-ink-faint text-center pb-4">
          Chilled food may be out above 8°C for a single period of less than four hours, and only if it has never been out
          before (Food Safety and Hygiene (England) Regulations 2013, Sch. 4). Made today, sold today.
        </p>
      </div>
    </div>
  );
}
