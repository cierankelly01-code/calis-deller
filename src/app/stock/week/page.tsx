"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchDeliverySpend, fetchStockLines, fetchStockLogs, type DeliverySpendRow } from "@/lib/data/queries";
import { localDateStr } from "@/lib/counter/board";
import {
  TAG_LABELS,
  WEEKDAYS,
  formatMoney,
  formatQty,
  formatShortDay,
  shiftDay,
  supplierSpend,
  weekReport,
  weekStart,
  weekdayIndex,
  type StockLog,
} from "@/lib/stock/ledger";
import { pricesOf } from "@/lib/stock/lines";
import { buildSummaryPrompt } from "@/lib/stock/prompt";

// The week at a glance for the shop on screen, and the button that turns
// both shops' weeks into a prompt to paste to Claude. Loads ~10 weeks so
// "vs last 4 weeks" works for any of the last six weeks.

type ShopData = Record<string, { logs: StockLog[]; deliveries: DeliverySpendRow[] }>;

export default function StockWeekPage() {
  const { site, sites } = useSite();
  const today = localDateStr(new Date());
  const { data: lines } = useCachedQuery("cd-stock-lines", fetchStockLines);
  const siteKey = sites.map((s) => s.id).join(",");
  const { data: shopData, loading, error } = useCachedQuery<ShopData>(`cd-stock-weeks:${siteKey}`, async () => {
    const entries = await Promise.all(
      sites.map(async (s) => [s.id, { logs: await fetchStockLogs(s.id, 70), deliveries: await fetchDeliverySpend(s.id, 70) }] as const)
    );
    return Object.fromEntries(entries);
  });

  const thisWeek = weekStart(today);
  const [from, setFrom] = useState(thisWeek);
  const [copied, setCopied] = useState<"idle" | "done" | "manual">("idle");
  const [promptText, setPromptText] = useState<string | null>(null);

  const prices = useMemo(() => pricesOf(lines ?? []), [lines]);
  const logsFor = (siteId: string) => shopData?.[siteId]?.logs ?? [];
  const report = useMemo(() => weekReport(shopData?.[site.id]?.logs ?? [], prices, from, today), [shopData, site.id, prices, from, today]);
  const spend = useMemo(() => supplierSpend(shopData?.[site.id]?.deliveries ?? [], from), [shopData, site.id, from]);
  const spendTotal = spend.reduce((n, s) => n + s.total, 0);

  const withSales = report.products.filter((p) => p.sold > 0);
  const best = withSales.slice(0, 3);
  const worst = [...withSales].filter((p) => !best.includes(p)).reverse().slice(0, 3);
  const mostWaste = [...report.products].filter((p) => (p.wasteCost ?? 0) > 0).sort((a, b) => (b.wasteCost ?? 0) - (a.wasteCost ?? 0)).slice(0, 3);
  const checks = report.products.flatMap((p) => p.checks.map((c) => ({ name: p.productName, text: c })));

  async function copySummary() {
    const text = buildSummaryPrompt(
      sites.map((s) => ({
        shopName: s.short_name,
        report: weekReport(logsFor(s.id), prices, from, today),
        spend: supplierSpend(shopData?.[s.id]?.deliveries ?? [], from),
      }))
    );
    setPromptText(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      // Clipboard blocked (older iPad Safari, no permission): show it to copy by hand.
      setCopied("manual");
    }
  }

  const stat = (label: string, value: string, tone = "text-ink") => (
    <div className="rounded-2xl bg-surface border border-line px-4 py-3">
      <p className="text-xs uppercase tracking-wider text-ink-soft font-semibold">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Stock — the week" backHref="/stock" />
      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => { setFrom(shiftDay(from, -7)); setCopied("idle"); }} className="h-11 w-11 rounded-full bg-surface border border-line text-xl" aria-label="Previous week">‹</button>
          <p className="font-bold text-ink text-center">
            {formatShortDay(from)} – {formatShortDay(shiftDay(from, 6))}
            {from === thisWeek && <span className="block text-xs font-normal text-ink-soft">This week, so far</span>}
          </p>
          <button type="button" disabled={from >= thisWeek} onClick={() => { setFrom(shiftDay(from, 7)); setCopied("idle"); }} className="h-11 w-11 rounded-full bg-surface border border-line text-xl disabled:opacity-30" aria-label="Next week">›</button>
        </div>

        {loading && !shopData && <p className="text-ink-faint">Loading…</p>}
        {error && !shopData && <p className="text-danger">Connect to the internet to load the figures.</p>}

        <section className="rounded-2xl bg-ink text-paper px-5 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.18em] text-paper/60 font-bold">For Claude</p>
          <p className="mt-1 text-sm text-paper/80">
            Copies this week&apos;s figures for {sites.length > 1 ? "both shops" : "the shop"} as a ready-made message. Paste it to Claude and talk it through.
          </p>
          <button type="button" onClick={copySummary} disabled={!shopData} className="mt-3 w-full h-14 rounded-2xl bg-gold text-ink text-lg font-bold shadow-sm active:scale-[0.99] disabled:opacity-40">
            {copied === "done" ? "✓ Copied — paste it to Claude" : "📋 Copy weekly summary"}
          </button>
          {copied === "manual" && <p className="mt-2 text-sm text-gold">Couldn&apos;t copy automatically. Select the text below and copy it.</p>}
        </section>
        {promptText && (
          <details open={copied === "manual"} className="rounded-2xl bg-surface border border-line px-4 py-3">
            <summary className="font-semibold text-ink cursor-pointer">See what gets sent</summary>
            <textarea readOnly value={promptText} onFocus={(e) => e.currentTarget.select()} className="mt-3 w-full min-h-80 rounded-xl border border-line bg-paper p-3 font-mono text-xs" />
          </details>
        )}

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">{site.short_name}</h2>
          <div className="grid grid-cols-2 gap-2">
            {stat("Sales", formatMoney(report.totals.revenue))}
            {stat("Profit", formatMoney(report.totals.profit), "text-brand-deep")}
            {stat("Binned", formatMoney(report.totals.wasteCost), report.totals.wasteCost > 0 ? "text-danger" : "text-ink")}
            {stat("Invoices", spend.length ? formatMoney(spendTotal) : "–")}
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            Counts done {report.countDays.length} of 7 days. Sales and profit cover the tracked lines only, at your prices.
            {report.unpriced.length > 0 && ` No price yet: ${report.unpriced.join(", ")}.`}
          </p>
        </section>

        {report.products.length === 0 ? (
          <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
            No figures for this week yet. Sold is worked out between two counts, so it takes two nights of close counts to get going.
          </p>
        ) : (
          <>
            {best.length > 0 && (
              <section className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl bg-brand-soft border border-brand/20 px-4 py-3">
                  <p className="text-xs uppercase tracking-wider text-brand font-bold mb-1.5">Making you the most</p>
                  {best.map((p) => (
                    <p key={p.key} className="text-sm text-ink"><strong>{p.productName}</strong> · {p.profit != null ? `${formatMoney(p.profit)} profit` : `${formatQty(p.sold, p.unit)} sold`}</p>
                  ))}
                </div>
                {worst.length > 0 && (
                  <div className="rounded-2xl bg-surface border border-line px-4 py-3">
                    <p className="text-xs uppercase tracking-wider text-ink-soft font-bold mb-1.5">Making you the least</p>
                    {worst.map((p) => (
                      <p key={p.key} className="text-sm text-ink"><strong>{p.productName}</strong> · {p.profit != null ? `${formatMoney(p.profit)} profit` : `${formatQty(p.sold, p.unit)} sold`}</p>
                    ))}
                  </div>
                )}
                {mostWaste.length > 0 && (
                  <div className="rounded-2xl bg-danger-soft border border-danger/30 px-4 py-3 sm:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-danger font-bold mb-1.5">Binned the most</p>
                    {mostWaste.map((p) => (
                      <p key={p.key} className="text-sm text-ink"><strong>{p.productName}</strong> · {formatQty(p.binned, p.unit)} · {formatMoney(p.wasteCost ?? 0)}</p>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section>
              <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Every line, best profit first</h2>
              <div className="space-y-2">
                {report.products.map((p) => (
                  <div key={p.key} className="rounded-2xl bg-surface border border-line px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-bold text-ink">{p.productName}</p>
                      <p className="text-sm font-semibold tabular-nums text-ink">{formatQty(p.sold, p.unit)} sold</p>
                    </div>
                    <p className="text-sm text-ink-soft tabular-nums">
                      {p.revenue == null ? "No sell price" : `${formatMoney(p.revenue)} sales`}
                      {p.profit != null && ` · ${formatMoney(p.profit)} profit`}
                      {p.margin != null && ` (${p.margin}%)`}
                      {p.binned > 0 && ` · ${formatQty(p.binned, p.unit)} binned`}
                      {p.prevWeeksAvg != null && p.prevWeeksAvg > 0 && ` · ${p.sold >= p.prevWeeksAvg ? "▲" : "▼"} vs ${formatQty(p.prevWeeksAvg, p.unit)} usual`}
                    </p>
                    {p.soldOuts.length > 0 && (
                      <p className="text-sm text-danger font-semibold">Sold out: {p.soldOuts.map((s) => `${WEEKDAYS[weekdayIndex(s.date)]} ${s.time}`).join(", ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Sold each day</h2>
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-ink-soft">
                      <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-surface">Product</th>
                      {WEEKDAYS.map((d) => <th key={d} className="font-semibold px-2 py-2 text-right">{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {report.products.map((p) => {
                      const max = Math.max(0, ...p.byWeekday.map((v) => v ?? 0));
                      return (
                        <tr key={p.key} className="border-t border-line">
                          <td className="px-3 py-2 font-semibold text-ink sticky left-0 bg-surface whitespace-nowrap">{p.productName}</td>
                          {p.byWeekday.map((v, i) => (
                            <td key={i} className={`px-2 py-2 text-right whitespace-nowrap ${v != null && v === max && max > 0 ? "font-bold text-brand-deep" : "text-ink"}`}>
                              {v == null ? "–" : p.unit === "kg" ? v.toFixed(1) : v}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-xs text-ink-soft">Kg lines in kg. Bold = that line&apos;s best day. Day-of-week patterns need 3–4 weeks of counts to mean much.</p>
            </section>

            {report.notes.length > 0 && (
              <section>
                <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">What the days were like</h2>
                <ul className="space-y-1 text-sm text-ink">
                  {report.notes.map((n) => (
                    <li key={n.date}><strong>{formatShortDay(n.date)}:</strong> {[...n.tags.map((t) => TAG_LABELS[t] ?? t), n.note ? `“${n.note}”` : ""].filter(Boolean).join(" · ")}</li>
                  ))}
                </ul>
              </section>
            )}

            {spend.length > 0 && (
              <section>
                <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Invoices by supplier</h2>
                <ul className="space-y-1 text-sm text-ink">
                  {spend.map((s) => <li key={s.supplier}><strong>{s.supplier}</strong> · {formatMoney(s.total)} ({s.deliveries} deliver{s.deliveries === 1 ? "y" : "ies"})</li>)}
                </ul>
              </section>
            )}

            {checks.length > 0 && (
              <section className="rounded-2xl bg-gold-soft border border-gold/50 px-4 py-3">
                <h2 className="text-[13px] font-semibold text-gold-deep uppercase tracking-wider mb-1.5">Worth a look</h2>
                <ul className="space-y-1 text-sm text-ink">
                  {checks.map((c, i) => <li key={i}><strong>{c.name}</strong> — {c.text}</li>)}
                </ul>
              </section>
            )}
          </>
        )}

        <Link href="/stock/count" className="block text-center text-sm font-semibold text-brand underline underline-offset-2">Go to tonight&apos;s close count</Link>
      </div>
    </div>
  );
}
