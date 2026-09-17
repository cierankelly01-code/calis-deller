"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import {
  fetchActiveStaff,
  fetchActiveFridgeUnits,
  fetchCounterStock,
  fetchTodayFridgeLogs,
  fetchRecentDeliveries,
} from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import {
  REASONS,
  customerAdvice,
  describeDaysLeft,
  formatDay,
  localDateStr,
  openBatches,
  rotationStats,
  summarise,
  type CounterLog,
  type OpenBatch,
} from "@/lib/counter/board";
import type { CounterStockLogRow } from "@/types/database";

// The counter board: every open batch on the serve-overs right now, soonest
// to bin first, colour-coded like a day-dot that can't fall off. This is the
// screen for the opening check ("anything past its date?"), for a customer
// asking "how long will this keep?", and for the EHO asking "how do you know
// which ham is the old one?". Taking a batch off is one tap + a reason, so
// the register closes every batch it opens.

type Reason = NonNullable<CounterStockLogRow["reason"]>;

const STATUS_STYLE = {
  ok: { card: "bg-surface border-line", pill: "bg-brand-soft text-brand-deep" },
  today: { card: "bg-gold-soft border-gold/50", pill: "bg-gold text-ink" },
  overdue: { card: "bg-danger-soft border-danger/40", pill: "bg-danger text-white" },
} as const;

export default function CounterBoardPage() {
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: units } = useCachedQuery(`cd-fridge-units:${site.id}`, () => fetchActiveFridgeUnits(site.id));
  const { data: stockLogs, loading, error } = useCachedQuery(`cd-counter-stock:${site.id}`, () => fetchCounterStock(site.id));
  const { data: todayFridgeLogs } = useCachedQuery(`cd-today-fridge-logs:${site.id}`, () => fetchTodayFridgeLogs(site.id));
  const { data: deliveries } = useCachedQuery(`cd-recent-deliveries:${site.id}`, () => fetchRecentDeliveries(site.id));
  const [showProcedure, setShowProcedure] = useState(false);

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  // Entries queued from this device this visit — the server list refreshes on
  // its own schedule, so the board is the union of both.
  const [localLogs, setLocalLogs] = useState<CounterLog[]>([]);
  const [closing, setClosing] = useState<string | null>(null); // batch clientId being taken off
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const today = localDateStr(new Date());
  const batches = useMemo(() => {
    const byId = new Map<string, CounterLog>();
    for (const log of [...localLogs, ...(stockLogs ?? [])]) byId.set(log.client_id, log);
    return openBatches([...byId.values()], today);
  }, [localLogs, stockLogs, today]);
  const summary = summarise(batches);
  const stats = useMemo(() => rotationStats(stockLogs ?? [], today), [stockLogs, today]);

  const unitName = (id: string) => units?.find((u) => u.id === id)?.name ?? "Serve-over";
  const staffName = (id: string) => staff?.find((s) => s.id === id)?.name ?? "staff";
  const deliveryLabel = (id: string | null) => {
    const delivery = id ? deliveries?.find((d) => d.id === id) : undefined;
    return delivery ? `${delivery.supplier_name} · ${formatDay(localDateStr(new Date(delivery.recorded_at)))}` : null;
  };
  // A serve-over that read warm today is a stock problem as much as a fridge
  // problem: the batches in it may not have the life the date says they do.
  const warmUnit = (unitId: string) => {
    const latest = (todayFridgeLogs ?? []).find((log) => log.unit_id === unitId);
    return latest && !latest.in_range ? latest : null;
  };

  const groups = useMemo(() => {
    const map = new Map<string, OpenBatch[]>();
    for (const batch of batches) {
      const list = map.get(batch.unitId) ?? [];
      list.push(batch);
      map.set(batch.unitId, list);
    }
    // Keep the shop's own unit order, unknown units last.
    const order = (units ?? []).map((u) => u.id);
    return [...map.entries()].sort(
      ([a], [b]) => (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b))
    );
  }, [batches, units]);

  function startClosing(batch: OpenBatch) {
    setSaveError(null);
    setReason(batch.status === "overdue" || batch.status === "today" ? "end_of_life" : null);
    setNote("");
    setClosing(closing === batch.clientId ? null : batch.clientId);
  }

  async function confirmTakenOff(batch: OpenBatch) {
    if (!staffId || !reason || saving) return;
    if (reason === "other" && note.trim().length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        staff_id: staffId,
        event: "taken_off" as const,
        batch_client_id: batch.clientId,
        product_id: batch.productId ?? null,
        product_name: batch.productName,
        unit_id: batch.unitId,
        reason,
        note: note.trim() || null,
        recorded_at: new Date().toISOString(),
      };
      const clientId = await queueEntry("counter_stock_logs", payload);
      const row: CounterLog = {
        ...payload,
        id: clientId,
        client_id: clientId,
        open_life_days: null,
        pack_use_by: null,
        discard_by: null,
        batch_code: null,
        delivery_log_id: null,
      };
      appendToTodayCache(`cd-counter-stock:${site.id}`, row);
      setLocalLogs((list) => [row, ...list]);
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

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Counter Stock" />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-6 max-w-2xl w-full mx-auto">
        {/* Print-only letterhead: the board doubles as the day's paper counter sheet. */}
        <div className="hidden print:block text-center space-y-1">
          <p className="font-display text-2xl font-semibold">{site.name} — Counter Stock</p>
          <p className="text-sm">{formatDay(today)} · open batches on the serve-overs, soonest to bin first</p>
        </div>

        <section
          className={`rounded-2xl px-5 py-4 shadow-sm ${
            summary.overdue > 0 ? "bg-danger text-white" : summary.dueToday > 0 ? "bg-gold text-ink" : "bg-ink text-paper"
          }`}
        >
          <p className="text-xs uppercase tracking-[0.18em] font-bold opacity-70">On the counter now</p>
          <p className="mt-1 text-lg font-bold">
            {summary.overdue > 0
              ? `${summary.overdue} past ${summary.overdue === 1 ? "its" : "their"} date — bin now`
              : summary.dueToday > 0
                ? `${summary.dueToday} on ${summary.dueToday === 1 ? "its" : "their"} last day — bin tonight`
                : summary.open === 0
                  ? "Nothing on the register"
                  : "Everything in date"}
          </p>
          <p className="mt-1 text-sm opacity-75">
            {summary.open} open {summary.open === 1 ? "batch" : "batches"} · oldest sells first · new stock goes underneath
          </p>
        </section>

        <Link
          href="/log/counter"
          className="flex items-center gap-4 rounded-2xl bg-brand text-white px-5 py-4 shadow-sm active:scale-[0.99] transition-transform print:hidden"
        >
          <span className="text-3xl" aria-hidden>➕</span>
          <span>
            <span className="block text-lg font-bold">Put out new stock</span>
            <span className="block text-sm text-white/75">Ham, pies, salads… anything opened for the counter</span>
          </span>
          <span className="ml-auto text-2xl text-white/60" aria-hidden>›</span>
        </Link>

        {loading && batches.length === 0 && <p className="text-ink-faint">Loading…</p>}
        {error && batches.length === 0 && <p className="text-danger font-medium">{error}</p>}

        {!loading && batches.length === 0 && !error && (
          <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
            Nothing recorded on the counter yet. Each time an open product goes into a serve-over, put it
            out here — the app works out the bin-by date and keeps the rotation record for the EHO.
          </p>
        )}

        {groups.map(([unitId, list]) => {
          const warm = warmUnit(unitId);
          return (
          <section key={unitId}>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
              🧊 {unitName(unitId)} <span className="text-ink-faint">({list.length})</span>
            </h2>
            {warm && (
              <div className="mb-2.5 rounded-2xl bg-danger-soft border border-danger/40 px-4 py-3 text-sm" role="alert">
                <p className="font-bold text-danger-deep">
                  ⚠ This serve-over read {warm.reading_c}°C at{" "}
                  {new Date(warm.recorded_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} — out of range
                </p>
                <p className="mt-0.5 text-ink-soft">
                  Check the stock in it before selling: food that has been above 8°C for over 4 hours should be binned.
                </p>
              </div>
            )}
            <div className="space-y-2.5">
              {list.map((batch) => {
                const style = STATUS_STYLE[batch.status];
                const isClosing = closing === batch.clientId;
                return (
                  <div key={batch.clientId} className={`rounded-2xl border shadow-sm px-4 py-3.5 ${style.card}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-ink leading-tight">
                          {batch.productName}
                          {batch.sellFirst && (
                            <span className="ml-2 align-middle inline-block rounded-full bg-ink text-paper text-[11px] font-bold uppercase tracking-wider px-2 py-0.5">
                              Oldest — sell first
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-sm text-ink-soft">
                          Out {formatDay(localDateStr(new Date(batch.openedAt)))} · {staffName(batch.staffId)}
                          {batch.batchCode && ` · batch ${batch.batchCode}`}
                          {batch.packUseBy && ` · pack use-by ${formatDay(batch.packUseBy)}`}
                          {deliveryLabel(batch.deliveryLogId) && ` · from 🚚 ${deliveryLabel(batch.deliveryLogId)}`}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${style.pill}`}>
                        {describeDaysLeft(batch.daysLeft)}
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-semibold text-ink">Bin by {formatDay(batch.discardBy)}</span>
                      <span className="text-ink-soft">
                        Tell customer: <span className="font-semibold text-ink">{customerAdvice(batch.customerDays)}</span>
                      </span>
                    </div>

                    {!isClosing ? (
                      <button
                        type="button"
                        onClick={() => startClosing(batch)}
                        className="mt-3 h-11 w-full rounded-xl bg-surface border border-line font-semibold text-ink active:scale-[0.99] print:hidden"
                      >
                        {batch.status === "ok" ? "Taken off / sold out" : "Taken off — bin it"}
                      </button>
                    ) : (
                      <div className="mt-3 space-y-3 rounded-xl bg-paper border border-line p-3 print:hidden">
                        <p className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">Why is it coming off?</p>
                        <div className="grid grid-cols-2 gap-2">
                          {(Object.keys(REASONS) as Reason[]).map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setReason(key)}
                              className={`min-h-12 rounded-xl px-3 text-sm font-semibold transition-all active:scale-95 ${
                                reason === key ? "bg-ink text-paper shadow-sm" : "bg-surface text-ink border border-line"
                              }`}
                            >
                              {REASONS[key]}
                            </button>
                          ))}
                        </div>
                        {reason === "other" && (
                          <textarea
                            maxLength={2000}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Say what happened…"
                            className="w-full rounded-xl border border-line bg-surface p-3 text-base min-h-20 placeholder:text-ink-faint focus:outline-none focus:border-brand"
                          />
                        )}
                        <p className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">Who&apos;s taking it off?</p>
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
                            disabled={!staffId || !reason || saving || (reason === "other" && note.trim().length === 0)}
                            onClick={() => confirmTakenOff(batch)}
                            className="flex-[2] h-12 rounded-xl bg-brand text-white font-bold active:bg-brand-deep disabled:opacity-40"
                          >
                            {saving ? "Saving…" : "Confirm taken off"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          );
        })}

        <section className="rounded-2xl bg-surface border border-line px-4 py-4">
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">
            Last {stats.days} days — prove it
          </h2>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-ink tabular-nums">{stats.putOut}</p>
              <p className="text-xs text-ink-soft">batches put out</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-brand tabular-nums">{stats.soldOut}</p>
              <p className="text-xs text-ink-soft">sold out</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gold-deep tabular-nums">{stats.binnedInDate}</p>
              <p className="text-xs text-ink-soft">binned in date</p>
            </div>
            <div>
              <p className={`text-2xl font-bold tabular-nums ${stats.binnedLate > 0 ? "text-danger" : "text-brand"}`}>
                {stats.binnedLate}
              </p>
              <p className="text-xs text-ink-soft">taken off late</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-faint text-center">
            &ldquo;Taken off late&rdquo; means a batch was still recorded on the counter after its bin-by date. Keep it at
            zero — it&apos;s the first number an inspector will look at.
          </p>
        </section>

        <section className="rounded-2xl bg-surface border border-line px-4 py-4">
          <button
            type="button"
            onClick={() => setShowProcedure((v) => !v)}
            className="w-full flex items-center justify-between text-left print:hidden"
            aria-expanded={showProcedure}
          >
            <span className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">
              📋 Our stock rotation procedure
            </span>
            <span className="text-ink-faint" aria-hidden>{showProcedure ? "▴" : "▾"}</span>
          </button>
          <div className={`${showProcedure ? "block" : "hidden"} print:block mt-3 space-y-2 text-sm text-ink`}>
            <p className="hidden print:block text-[13px] font-semibold text-ink-soft uppercase tracking-wider">
              Our stock rotation procedure
            </p>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>Every open product going into a serve-over is recorded here as <strong>put out</strong> by the person doing it, before it goes on sale.</li>
              <li>Open life is <strong>{"3 days including the day it goes out"}</strong> unless the product is set shorter, and never past the pack&apos;s own use-by. The app works out the bin-by date; staff don&apos;t count days.</li>
              <li><strong>New stock goes underneath old stock.</strong> When the same product is already out, the older batch is marked &ldquo;oldest — sell first&rdquo; and is served from first.</li>
              <li>Customers buying loose product are told to <strong>use within the days shown on the board</strong> for that batch — never longer than the batch has left.</li>
              <li>At <strong>opening</strong> the board is checked and anything past its date is binned and recorded as taken off (end of life). At <strong>closing</strong> anything on its last day is taken off.</li>
              <li>Every batch is closed as <strong>sold out</strong> or <strong>binned</strong> with the reason and the person&apos;s name. Records are permanent and cannot be edited or deleted.</li>
              <li>If a serve-over is found out of temperature range, the stock in it is checked before sale and binned if it has been above 8°C for more than 4 hours.</li>
            </ol>
            <p className="text-xs text-ink-faint">
              Written to the FSA Safer Food, Better Business for Retailers &ldquo;Stock control&rdquo; and &ldquo;Ready-to-eat food&rdquo; safe methods. All staff are shown this procedure and the board before working the counter.
            </p>
          </div>
        </section>

        <button
          type="button"
          onClick={() => window.print()}
          className="w-full h-12 rounded-xl bg-surface border border-line font-bold text-ink active:scale-[0.99] print:hidden"
        >
          🖨️ Print the board — {formatDay(today)}
        </button>

        <p className="text-xs text-ink-faint text-center pb-4">
          Open food is sold within its open life (day it goes out = day 1) or the pack&apos;s use-by, whichever is
          sooner. Every put-out and take-off is a permanent diary entry.
        </p>
      </div>
    </div>
  );
}
