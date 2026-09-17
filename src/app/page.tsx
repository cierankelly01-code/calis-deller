"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import {
  fetchActiveFridgeUnits,
  fetchTodayFridgeLogs,
  fetchActiveCleaningTasks,
  fetchTodayCleaningLogs,
  fetchCounterStock,
  fetchAmbientDisplay,
} from "@/lib/data/queries";
import { currentSlot, computeUnitSlotStatus } from "@/lib/dashboard/dueStatus";
import { openBatches, summarise } from "@/lib/counter/board";
import { describeRemaining, formatClock, fridgeReserve, outNow, summariseAmbient } from "@/lib/ambient/board";
import { SyncStatusPill } from "@/components/ui/SyncStatusPill";
import { useUser } from "@/components/auth/AuthBoundary";

const LOG_TILES = [
  { href: "/log/fridge", emoji: "🧊", title: "Fridge round", sub: "AM & PM temps" },
  { href: "/log/cooking", emoji: "🍳", title: "Hot food check", sub: "Cook · reheat · hot hold" },
  { href: "/log/delivery", emoji: "🚚", title: "Delivery in", sub: "Van temp & condition" },
  { href: "/log/cleaning", emoji: "🧽", title: "Cleaning", sub: "Opening & closing" },
  { href: "/log/probe", emoji: "🌡️", title: "Probe check", sub: "Weekly calibration" },
  { href: "/counter", emoji: "🥩", title: "Counter stock", sub: "Put out · take off · dates" },
  { href: "/sandwiches", emoji: "🥪", title: "Sandwiches", sub: "4-hour timer · fridge reserve" },
  { href: "/diary", emoji: "📖", title: "Diary", sub: "Any day's records" },
] as const;

function todayHeading(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function DashboardPage() {
  const user = useUser();
  const { site } = useSite();
  const { data: units } = useCachedQuery(`cd-fridge-units:${site.id}`, () => fetchActiveFridgeUnits(site.id));
  const { data: todayLogs, loading } = useCachedQuery(`cd-today-fridge-logs:${site.id}`, () => fetchTodayFridgeLogs(site.id));
  const { data: cleaningTasks } = useCachedQuery(`cd-cleaning-tasks:${site.id}`, () => fetchActiveCleaningTasks(site.id));
  const { data: todayCleaning } = useCachedQuery(`cd-today-cleaning-logs:${site.id}`, () => fetchTodayCleaningLogs(site.id));
  const { data: counterLogs } = useCachedQuery(`cd-counter-stock:${site.id}`, () => fetchCounterStock(site.id));
  const { data: ambientLogs } = useCachedQuery(`cd-ambient:${site.id}`, () => fetchAmbientDisplay(site.id));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const slot = currentSlot();
  const statuses = useMemo(
    () => computeUnitSlotStatus(units ?? [], todayLogs ?? [], slot),
    [units, todayLogs, slot]
  );

  const session = slot === "am" ? "open" : "close";
  const cleaning = useMemo(() => {
    const total = (cleaningTasks ?? []).filter(
      (t) => t.session === session || t.session === "both"
    ).length;
    const done = new Set(
      (todayCleaning ?? []).filter((l) => l.session === session).map((l) => l.task_id)
    ).size;
    return { total, done };
  }, [cleaningTasks, todayCleaning, session]);

  // Open counter batches past their date are a live problem, not a scheduled
  // check — they block "ready for service" until they're taken off.
  const counter = useMemo(() => summarise(openBatches(counterLogs ?? [])), [counterLogs]);
  const sandwichGroups = useMemo(() => outNow(ambientLogs ?? [], now), [ambientLogs, now]);
  const sandwiches = useMemo(() => summariseAmbient(sandwichGroups, fridgeReserve(ambientLogs ?? [])), [sandwichGroups, ambientLogs]);

  const fridgesDue = statuses.filter((s) => !s.done).length;
  const cleaningDue = cleaning.total > 0 && cleaning.done < cleaning.total;
  const anyOutOfRange = statuses.some((s) => s.inRange === false);
  const allCaughtUp =
    statuses.length > 0 && fridgesDue === 0 && !cleaningDue && !anyOutOfRange && counter.overdue === 0 && sandwiches.overdue === 0;

  return (
    <div className="flex flex-col flex-1">
      <header className="border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className="px-5 py-5 max-w-2xl w-full mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-[28px] font-semibold text-brand-deep leading-tight">
              Kelly&apos;s Deli
            </h1>
            <p className="text-sm text-ink-soft">{site.short_name} · {todayHeading()}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <SyncStatusPill />
            {user?.role === "manager" && <Link href="/settings" className="h-11 w-11 flex items-center justify-center rounded-full bg-paper border border-line text-xl active:scale-95 transition-transform" aria-label="Settings">⚙️</Link>}
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-7">
        <section className="rounded-2xl bg-ink text-paper px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-xs uppercase tracking-[0.18em] text-paper/60 font-bold">Today&apos;s record</p><p className="mt-1 text-lg font-bold">{allCaughtUp ? "Ready for service" : `${fridgesDue + (cleaningDue ? 1 : 0) + (counter.overdue > 0 ? 1 : 0) + (sandwiches.overdue > 0 ? 1 : 0)} checks left`}</p></div>
            <span className="text-3xl" aria-hidden>{allCaughtUp ? "✓" : "◷"}</span>
          </div>
          {!allCaughtUp && <div className="mt-3 h-1.5 rounded-full bg-paper/20 overflow-hidden"><div className="h-full rounded-full bg-gold transition-all" style={{width:`${statuses.length ? Math.max(8,((statuses.length-fridgesDue)/statuses.length)*100) : 8}%`}} /></div>}
          <p className="mt-2 text-xs text-paper/65">{allCaughtUp ? "All scheduled checks are recorded for this part of the day." : "Tap a due check below and keep the diary complete."}</p>
        </section>
        <Link href="/diary" className="block rounded-2xl border border-brand/20 bg-brand-soft px-5 py-4 active:scale-[0.99] transition-transform">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs uppercase tracking-[0.18em] text-brand font-bold">EHO ready</p><p className="mt-1 text-base font-bold text-brand-deep">Keep the last 28 days together</p><p className="mt-1 text-sm text-ink-soft">Open the diary to review records before an inspection.</p></div>
            <span className="text-2xl text-brand/60" aria-hidden>›</span>
          </div>
        </Link>
        <Link
          href="/allergens"
          className="flex items-center gap-4 rounded-2xl bg-gold px-5 py-4.5 shadow-sm active:scale-[0.99] transition-transform"
        >
          <span className="text-3xl" aria-hidden>
            ⚠️
          </span>
          <span>
            <span className="block text-lg font-bold text-ink">Allergen Guide</span>
            <span className="block text-sm text-ink/75">
              Customer asking? Search any product, or filter by allergy
            </span>
          </span>
          <span className="ml-auto text-2xl text-ink/50" aria-hidden>
            ›
          </span>
        </Link>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            {slot === "am" ? "This morning" : "This afternoon"}
          </h2>

          {loading && statuses.length === 0 && <p className="text-ink-faint">Loading…</p>}

          {!loading && statuses.length === 0 && (
            <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
              No fridge units set up yet —{" "}
              <Link href="/settings/units" className="text-brand font-semibold underline">
                add them in Settings
              </Link>
              .
            </p>
          )}

          {allCaughtUp && (
            <div className="rounded-2xl bg-brand-soft border border-brand/20 px-4 py-4 mb-2.5 text-center">
              <p className="font-bold text-brand-deep text-lg">✓ All caught up</p>
              <p className="text-sm text-ink-soft">
                Every {slot === "am" ? "morning" : "afternoon"} check is done.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {statuses.map((status) => (
              <Link
                key={status.unitId}
                href="/log/fridge"
                className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 active:scale-[0.99] transition-transform ${
                  status.inRange === false
                    ? "bg-danger-soft border-danger/30"
                    : "bg-surface border-line"
                }`}
              >
                <p className="font-semibold text-ink">{status.unitName}</p>
                {status.done ? (
                  <p
                    className={`text-sm font-semibold ${
                      status.inRange === false ? "text-danger" : "text-brand"
                    }`}
                  >
                    {status.reading}°C {status.inRange === false ? "⚠ out of range" : "✓"}
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-gold-deep">
                    {slot === "am" ? "morning" : "afternoon"} check due
                  </p>
                )}
              </Link>
            ))}

            {(sandwiches.out > 0 || sandwiches.inFridge > 0) && (
              <Link
                href="/sandwiches"
                className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 active:scale-[0.99] transition-transform ${
                  sandwiches.overdue > 0
                    ? "bg-danger-soft border-danger/30"
                    : sandwiches.soonestMsLeft !== null && sandwiches.soonestMsLeft <= 30 * 60 * 1000
                      ? "bg-gold-soft border-gold/50"
                      : "bg-surface border-line"
                }`}
              >
                <p className="font-semibold text-ink">🥪 Sandwiches</p>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    sandwiches.overdue > 0
                      ? "text-danger"
                      : sandwiches.soonestMsLeft !== null && sandwiches.soonestMsLeft <= 30 * 60 * 1000
                        ? "text-gold-deep"
                        : "text-brand"
                  }`}
                >
                  {sandwiches.overdue > 0
                    ? "⚠ over 4 hours — take off now"
                    : sandwiches.out > 0 && sandwiches.soonestMsLeft !== null
                      ? `${sandwiches.out} out · ${describeRemaining(sandwiches.soonestMsLeft)} · off by ${formatClock(sandwichGroups[0].offBy)}`
                      : `${sandwiches.inFridge} in the fridge · nothing out`}
                </p>
              </Link>
            )}

            {(counter.open > 0 || counter.overdue > 0) && (
              <Link
                href="/counter"
                className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 active:scale-[0.99] transition-transform ${
                  counter.overdue > 0
                    ? "bg-danger-soft border-danger/30"
                    : counter.dueToday > 0
                      ? "bg-gold-soft border-gold/50"
                      : "bg-surface border-line"
                }`}
              >
                <p className="font-semibold text-ink">🥩 Counter stock</p>
                <p
                  className={`text-sm font-semibold ${
                    counter.overdue > 0 ? "text-danger" : counter.dueToday > 0 ? "text-gold-deep" : "text-brand"
                  }`}
                >
                  {counter.overdue > 0
                    ? `⚠ ${counter.overdue} past date — bin now`
                    : counter.dueToday > 0
                      ? `${counter.dueToday} to bin tonight`
                      : `${counter.open} open · all in date ✓`}
                </p>
              </Link>
            )}

            {cleaning.total > 0 && (
              <Link
                href="/log/cleaning"
                className="flex items-center justify-between rounded-2xl bg-surface border border-line px-4 py-3.5 active:scale-[0.99] transition-transform"
              >
                <p className="font-semibold text-ink">
                  {session === "open" ? "🌅 Opening clean" : "🌙 Closing clean"}
                </p>
                <p
                  className={`text-sm font-semibold ${
                    cleaning.done >= cleaning.total ? "text-brand" : "text-gold-deep"
                  }`}
                >
                  {cleaning.done >= cleaning.total
                    ? "✓ complete"
                    : `${cleaning.done}/${cleaning.total} done`}
                </p>
              </Link>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Record a check
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {LOG_TILES.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                className="rounded-2xl bg-surface border border-line shadow-sm p-4 active:scale-[0.98] transition-transform"
              >
                <span
                  className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-2xl"
                  aria-hidden
                >
                  {tile.emoji}
                </span>
                <span className="block mt-2.5 font-bold text-ink">{tile.title}</span>
                <span className="block text-[13px] text-ink-soft">{tile.sub}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
