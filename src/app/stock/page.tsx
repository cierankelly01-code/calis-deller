"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { useUser } from "@/components/auth/AuthBoundary";
import { fetchActiveProducts, fetchActiveStaff, fetchStockLines, fetchStockLogs } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { localDateStr } from "@/lib/counter/board";
import { formatMoney, logDay, weekReport, weekStart, type StockLog } from "@/lib/stock/ledger";
import { pricesOf, trackedLines, type TrackedLine } from "@/lib/stock/lines";

// The stock hub: tonight's close count, the "we've run out" buttons, and the
// way into the weekly figures. Sold-out is quick on purpose — it happens
// mid-rush, and a sell-out that isn't logged is demand nobody ever sees —
// but takes a second tap to confirm, because the log can't be un-written.

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function StockPage() {
  const user = useUser();
  const { site } = useSite();
  const today = localDateStr(new Date());
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: products } = useCachedQuery("cd-products", fetchActiveProducts);
  const { data: lines } = useCachedQuery("cd-stock-lines", fetchStockLines);
  const { data: stockLogs, loading } = useCachedQuery(`cd-stock-logs:${site.id}`, () => fetchStockLogs(site.id));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [localLogs, setLocalLogs] = useState<StockLog[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // first tap: waiting for the confirming second
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tracked = useMemo(() => trackedLines(lines ?? [], products ?? []), [lines, products]);
  const logs = useMemo(() => {
    const byId = new Map<string, StockLog>();
    for (const log of [...localLogs, ...(stockLogs ?? [])]) byId.set(log.client_id, log);
    return [...byId.values()];
  }, [localLogs, stockLogs]);

  const todayCounts = logs.filter((l) => l.event === "count" && logDay(l) === today);
  const lastCountAt = todayCounts.reduce<string | null>((latest, l) => (!latest || l.recorded_at > latest ? l.recorded_at : latest), null);
  const countedProducts = new Set(todayCounts.map((l) => l.product_id)).size;

  const soldOutToday = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of logs) {
      if (log.event !== "sold_out" || logDay(log) !== today || !log.product_id) continue;
      const held = map.get(log.product_id);
      if (!held || log.recorded_at < held) map.set(log.product_id, log.recorded_at);
    }
    return map;
  }, [logs, today]);

  const week = useMemo(() => weekReport(logs, pricesOf(lines ?? []), weekStart(today), today), [logs, lines, today]);

  async function markSoldOut(line: TrackedLine) {
    if (!staffId || busy || soldOutToday.has(line.productId)) return;
    if (armed !== line.productId) return setArmed(line.productId);
    setArmed(null);
    setBusy(line.productId);
    setSaveError(null);
    try {
      const payload = { staff_id: staffId, event: "sold_out" as const, product_id: line.productId, product_name: line.name, tags: [], recorded_at: new Date().toISOString() };
      const clientId = await queueEntry("stock_logs", payload);
      const row: StockLog = { ...payload, id: clientId, client_id: clientId, unit: null, came_in: null, binned: null, on_hand: null, note: null, business_date: today };
      appendToTodayCache(`cd-stock-logs:${site.id}`, row);
      setLocalLogs((list) => [row, ...list]);
      void syncOutbox().catch(() => {});
    } catch (err) {
      setSaveError(`Could not save on this device: ${err instanceof Error ? err.message : "unknown error"}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Stock" />
      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        {!loading && tracked.length === 0 && (
          <div className="rounded-2xl bg-gold-soft border border-gold/50 px-4 py-4">
            <p className="font-bold text-ink">Pick what to track first</p>
            <p className="text-sm text-ink-soft mt-1">
              {user?.role === "manager" ? (
                <>Choose the products, how they&apos;re counted, and their prices in <Link href="/settings/stock" className="text-brand font-semibold underline">Stock list &amp; prices</Link>.</>
              ) : (
                "A manager sets up the stock list in Settings."
              )}
            </p>
          </div>
        )}

        <Link
          href="/stock/count"
          className={`block rounded-2xl px-5 py-4 shadow-sm active:scale-[0.99] transition-transform ${lastCountAt ? "bg-brand-soft border border-brand/20" : "bg-ink text-paper"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-xs uppercase tracking-[0.18em] font-bold ${lastCountAt ? "text-brand" : "text-paper/60"}`}>Tonight&apos;s close count</p>
              <p className={`mt-1 text-lg font-bold ${lastCountAt ? "text-brand-deep" : ""}`}>
                {lastCountAt ? `✓ Counted at ${clock(lastCountAt)} · ${countedProducts} of ${tracked.length}` : "Not done yet — start the count"}
              </p>
              <p className={`mt-1 text-sm ${lastCountAt ? "text-ink-soft" : "text-paper/70"}`}>
                {lastCountAt ? "Tap to recount anything — the latest count wins." : "What came in, what was binned, what's left."}
              </p>
            </div>
            <span className={`text-2xl ${lastCountAt ? "text-brand/60" : "text-paper/60"}`} aria-hidden>›</span>
          </div>
        </Link>

        {tracked.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-1">Run out of something?</h2>
            <p className="text-sm text-ink-soft mb-3">Tap it when it sells out. It shows where you could have sold more.</p>
            <div className="mb-3">
              <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
            </div>
            {saveError && <p role="alert" className="text-danger mb-2">{saveError}</p>}
            <div className="grid grid-cols-2 gap-2">
              {tracked.map((line) => {
                const outAt = soldOutToday.get(line.productId);
                const confirming = armed === line.productId;
                return (
                  <button
                    key={line.productId}
                    type="button"
                    disabled={!staffId || !!outAt || busy === line.productId}
                    onClick={() => markSoldOut(line)}
                    className={`min-h-14 rounded-2xl px-3 py-2 text-left text-sm font-semibold transition-all active:scale-95 disabled:active:scale-100 ${
                      outAt
                        ? "bg-danger-soft text-danger-deep border border-danger/30"
                        : confirming
                          ? "bg-gold text-ink border border-gold shadow-sm"
                          : "bg-surface text-ink border border-line shadow-sm disabled:opacity-50"
                    }`}
                  >
                    {line.name}
                    <span className="block text-xs font-normal">{outAt ? `Sold out at ${clock(outAt)}` : confirming ? "Tap again to confirm" : "Tap when sold out"}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <Link href="/stock/week" className="block rounded-2xl bg-surface border border-line px-5 py-4 shadow-sm active:scale-[0.99] transition-transform">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-ink-soft font-bold">This week so far</p>
              <p className="mt-1 text-base font-bold text-ink">
                {week.products.some((p) => p.sold > 0)
                  ? `${formatMoney(week.totals.revenue)} sales · ${formatMoney(week.totals.profit)} profit · ${formatMoney(week.totals.wasteCost)} binned`
                  : "Figures appear after two nights of counts"}
              </p>
              <p className="mt-1 text-sm text-ink-soft">Best and worst sellers, days of the week, and the summary to send to Claude.</p>
            </div>
            <span className="text-2xl text-ink-faint" aria-hidden>›</span>
          </div>
        </Link>

        {user?.role === "manager" && (
          <Link href="/settings/stock" className="block text-center text-sm font-semibold text-brand underline underline-offset-2">
            Stock list &amp; prices
          </Link>
        )}
      </div>
    </div>
  );
}
