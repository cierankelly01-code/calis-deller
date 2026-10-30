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
  fetchActiveStaff,
  fetchHotBatches,
  fetchSiteChecks,
  fetchRecentProbeChecks,
  fetchReviews,
  fetchTrainingRecords,
} from "@/lib/data/queries";
import { currentSlot, computeUnitSlotStatus } from "@/lib/dashboard/dueStatus";
import { openBatches, summarise } from "@/lib/counter/board";
import { describeRemaining, formatClock, fridgeReserve, outNow, summariseAmbient } from "@/lib/ambient/board";
import { onTheClock, summariseCooling } from "@/lib/cooling/board";
import { buildJobs, jobsLeft, type JobTone } from "@/lib/today/jobs";
import { certificatesNeedingAction, trainingByPerson } from "@/lib/training/status";
import { useRememberedStaff } from "@/lib/staffMemory";
import { useLiveQuery } from "@/lib/data/useLiveQuery";
import { SyncStatusPill } from "@/components/ui/SyncStatusPill";
import { useUser } from "@/components/auth/AuthBoundary";

// The home screen, built so anyone can pick up the iPad and know what to do:
// 1. tap your name, 2. do the red and yellow jobs (each has "How?"),
// 3. something happening? one big button for it. Everything the app did
// before is still one tap away under "All checks".

const HAPPENING = [
  { href: "/log/cooking", emoji: "🔥", title: "Out of the oven", sub: "Probe it · starts the 2-hour clock" },
  { href: "/log/delivery", emoji: "🚚", title: "Delivery in", sub: "Check the van and the food" },
  { href: "/sandwiches", emoji: "🥪", title: "Sandwiches", sub: "Made · put out · taken off" },
  { href: "/allergens", emoji: "⚠️", title: "Allergy question", sub: "Customer asking? Look it up" },
  { href: "/checks?kind=maintenance", emoji: "🔧", title: "Something broken", sub: "Fridge, sink, door, light" },
  { href: "/health", emoji: "🤒", title: "Feeling ill?", sub: "Sick or diarrhoea: tell the manager" },
] as const;

const ALL_CHECKS = [
  { href: "/log/fridge", emoji: "🧊", title: "Fridge round", sub: "AM & PM temps" },
  { href: "/log/cooking", emoji: "🍳", title: "Hot food check", sub: "Cook · reheat · hot hold" },
  { href: "/cooling", emoji: "⏱", title: "Cooling clock", sub: "Warm food: 2 hours" },
  { href: "/log/delivery", emoji: "🚚", title: "Delivery in", sub: "Van temp & condition" },
  { href: "/log/cleaning", emoji: "🧽", title: "Cleaning", sub: "Opening & closing" },
  { href: "/log/probe", emoji: "🌡️", title: "Probe check", sub: "Weekly calibration" },
  { href: "/checks", emoji: "🧼", title: "Quick checks", sub: "Hand sink · pests · repairs" },
  { href: "/counter", emoji: "🥩", title: "Counter stock", sub: "Put out · take off · dates" },
  { href: "/sandwiches", emoji: "🥪", title: "Sandwiches", sub: "Counter timer · fridge reserve" },
  { href: "/stock", emoji: "📦", title: "Stock", sub: "Close count · sold out · week" },
  { href: "/trace", emoji: "🔎", title: "Trace a batch", sub: "Cooked → cooled → sold" },
  { href: "/diary", emoji: "📖", title: "Diary", sub: "Any day's records" },
  { href: "/methods", emoji: "📘", title: "How to do it", sub: "Our safe methods" },
  { href: "/health", emoji: "🤒", title: "Fit for work", sub: "Sickness rule" },
  { href: "/review", emoji: "🗓", title: "4-weekly review", sub: "Manager signs" },
  { href: "/training", emoji: "🎓", title: "Training", sub: "Certificates (manager)" },
] as const;

const TONE: Record<JobTone, { row: string; dot: string; word: string }> = {
  red: { row: "bg-danger-soft border-danger/40", dot: "bg-danger", word: "Do now" },
  amber: { row: "bg-gold-soft border-gold/50", dot: "bg-gold", word: "To do" },
  green: { row: "bg-surface border-line", dot: "bg-brand", word: "Done" },
};

function todayHeading(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default function DashboardPage() {
  const user = useUser();
  const isManager = user?.role === "manager";
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: units } = useCachedQuery(`cd-fridge-units:${site.id}`, () => fetchActiveFridgeUnits(site.id));
  const { data: todayLogs } = useCachedQuery(`cd-today-fridge-logs:${site.id}`, () => fetchTodayFridgeLogs(site.id));
  const { data: cleaningTasks } = useCachedQuery(`cd-cleaning-tasks:${site.id}`, () => fetchActiveCleaningTasks(site.id));
  const { data: todayCleaning } = useCachedQuery(`cd-today-cleaning-logs:${site.id}`, () => fetchTodayCleaningLogs(site.id));
  const { data: counterLogs } = useCachedQuery(`cd-counter-stock:${site.id}`, () => fetchCounterStock(site.id));
  const { data: ambientLogs } = useCachedQuery(`cd-ambient:${site.id}`, () => fetchAmbientDisplay(site.id));
  const { data: hotLogs } = useCachedQuery(`cd-hot-batches:${site.id}`, () => fetchHotBatches(site.id));
  const { data: siteChecks } = useCachedQuery(`cd-site-checks:${site.id}`, () => fetchSiteChecks(site.id));
  const { data: probeChecks } = useCachedQuery(`cd-probe-checks:${site.id}`, () => fetchRecentProbeChecks(site.id));
  const { data: reviews } = useCachedQuery(`cd-reviews:${site.id}`, () => fetchReviews(site.id));
  const { data: training } = useLiveQuery(`training:${site.id}`, () => fetchTrainingRecords(site.id), isManager);
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [picking, setPicking] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const slot = currentSlot();
  const statuses = useMemo(() => computeUnitSlotStatus(units ?? [], todayLogs ?? [], slot), [units, todayLogs, slot]);
  const session = slot === "am" ? "open" : "close";
  const cleaning = useMemo(() => {
    const total = (cleaningTasks ?? []).filter((t) => t.session === session || t.session === "both").length;
    const done = new Set((todayCleaning ?? []).filter((l) => l.session === session).map((l) => l.task_id)).size;
    return { session, total, done } as const;
  }, [cleaningTasks, todayCleaning, session]);
  const counter = useMemo(() => summarise(openBatches(counterLogs ?? [])), [counterLogs]);
  const sandwichGroups = useMemo(() => outNow(ambientLogs ?? [], now), [ambientLogs, now]);
  const sandwiches = useMemo(() => summariseAmbient(sandwichGroups, fridgeReserve(ambientLogs ?? [])), [sandwichGroups, ambientLogs]);
  const cooling = useMemo(() => {
    const batches = onTheClock(hotLogs ?? [], now);
    return { ...summariseCooling(batches), label: batches[0] ? `next by ${formatClock(batches[0].dueBy)}` : null };
  }, [hotLogs, now]);
  const certs = useMemo(
    () => (isManager && training ? certificatesNeedingAction(trainingByPerson(training, (staff ?? []).map((s) => s.id))) : 0),
    [isManager, training, staff]
  );

  const jobs = useMemo(
    () =>
      buildJobs({
        now: new Date(now),
        slot,
        fridges: { total: statuses.length, due: statuses.filter((s) => !s.done).length, outOfRange: statuses.filter((s) => s.inRange === false).length },
        cleaning,
        cooling: { onClock: cooling.onClock, soon: cooling.soon, overdue: cooling.overdue, soonestLabel: cooling.label },
        sandwiches: {
          overdue: sandwiches.overdue,
          soon: sandwiches.soonestMsLeft !== null && sandwiches.soonestMsLeft <= 30 * 60 * 1000,
          label:
            sandwiches.out === 0 && sandwiches.inFridge === 0
              ? null
              : sandwiches.overdue > 0
                ? "Time's up: take them off now"
                : sandwiches.out > 0 && sandwiches.soonestMsLeft !== null
                  ? `${sandwiches.out} out · ${describeRemaining(sandwiches.soonestMsLeft)} · off by ${formatClock(sandwichGroups[0].offBy)}`
                  : `${sandwiches.inFridge} in the fridge · nothing out`,
        },
        counter,
        siteChecks: siteChecks ?? [],
        probeChecks: probeChecks ?? [],
        lastReviewAt: isManager ? (reviews?.[0]?.recorded_at ?? null) : undefined,
        certificatesExpiring: certs,
      }),
    [now, slot, statuses, cleaning, cooling, sandwiches, sandwichGroups, counter, siteChecks, probeChecks, isManager, reviews, certs]
  );
  const left = jobsLeft(jobs);
  const me = (staff ?? []).find((s) => s.id === staffId) ?? null;

  return (
    <div className="flex flex-col flex-1">
      <header className="border-b border-line bg-surface">
        <div className="px-5 py-4 max-w-2xl w-full mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-[28px] font-semibold text-brand-deep leading-tight">Kelly&apos;s Deli</h1>
            <p className="text-sm text-ink-soft">{site.short_name} · {todayHeading()}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <SyncStatusPill />
            {isManager && <Link href="/settings" className="h-11 w-11 flex items-center justify-center rounded-full bg-paper border border-line text-xl active:scale-95 transition-transform" aria-label="Settings">⚙️</Link>}
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-7">
        {/* 1. Who are you? */}
        <section>
          {me && !picking ? (
            <div className="flex items-center justify-between rounded-2xl bg-brand text-white px-5 py-4">
              <p className="text-xl font-bold">Hi {me.name} 👋</p>
              <button type="button" onClick={() => setPicking(true)} className="text-sm font-semibold underline underline-offset-2">Not you?</button>
            </div>
          ) : (
            <div className="rounded-2xl bg-surface border-2 border-brand/30 p-4">
              <p className="text-lg font-bold text-ink mb-3">1. Tap your name</p>
              {(staff ?? []).length === 0 ? <p className="text-ink-soft">No staff set up yet. A manager adds them in Settings › Staff.</p> : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {(staff ?? []).map((s) => (
                    <button key={s.id} type="button" onClick={() => { setStaffId(s.id); setPicking(false); }} className={`h-16 rounded-2xl text-lg font-semibold ${s.id === staffId ? "bg-brand text-white" : "bg-paper border border-line text-ink"}`}>{s.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2. What needs doing */}
        <section>
          <div className="flex items-end justify-between mb-2.5">
            <h2 className="text-lg font-bold text-ink">{me ? "Your jobs now" : "2. Jobs now"}</h2>
            <p className={`text-sm font-bold ${left === 0 ? "text-brand" : "text-gold-deep"}`}>{left === 0 ? "✓ All done" : `${left} to do`}</p>
          </div>
          <div className="space-y-2">
            {jobs.map((job) => {
              const tone = TONE[job.tone];
              return (
                <div key={job.key} className={`flex items-stretch rounded-2xl border overflow-hidden ${tone.row}`}>
                  <Link href={job.href} className="flex-1 flex items-center gap-3 px-4 py-3.5 min-w-0 active:opacity-80">
                    <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-bold text-ink">{job.title}</span>
                      <span className="block text-sm text-ink-soft">{tone.word} · {job.detail}</span>
                    </span>
                  </Link>
                  <Link href={`/methods/${job.method}`} className="w-16 shrink-0 grid place-items-center border-l border-black/5 text-sm font-semibold text-brand-deep" aria-label={`How to: ${job.title}`}>
                    <span className="text-center leading-tight"><span className="block text-lg" aria-hidden>📘</span>How?</span>
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. Something happening */}
        <section>
          <h2 className="text-lg font-bold text-ink mb-2.5">Something happening?</h2>
          <div className="grid grid-cols-2 gap-3">
            {HAPPENING.map((tile) => (
              <Link key={tile.href + tile.title} href={tile.href} className="rounded-2xl bg-surface border border-line shadow-sm p-4 active:scale-[0.98] transition-transform">
                <span className="text-3xl" aria-hidden>{tile.emoji}</span>
                <span className="block mt-2 font-bold text-ink">{tile.title}</span>
                <span className="block text-[13px] text-ink-soft">{tile.sub}</span>
              </Link>
            ))}
          </div>
        </section>

        <Link href="/inspector" className="flex items-center gap-4 rounded-2xl bg-ink text-paper px-5 py-4.5 shadow-sm active:scale-[0.99] transition-transform">
          <span className="text-3xl" aria-hidden>🛡️</span>
          <span>
            <span className="block text-lg font-bold">Inspector here?</span>
            <span className="block text-sm text-paper/75">Press this and hand them the iPad</span>
          </span>
          <span className="ml-auto text-2xl text-paper/50" aria-hidden>›</span>
        </Link>

        <section>
          <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="w-full flex items-center justify-between rounded-2xl bg-surface border border-line px-5 py-4 font-bold text-ink">
            All checks and records <span aria-hidden>{showAll ? "▲" : "▼"}</span>
          </button>
          {showAll && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {ALL_CHECKS.map((tile) => (
                <Link key={tile.href} href={tile.href} className="rounded-2xl bg-surface border border-line shadow-sm p-4 active:scale-[0.98] transition-transform">
                  <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-2xl" aria-hidden>{tile.emoji}</span>
                  <span className="block mt-2.5 font-bold text-ink">{tile.title}</span>
                  <span className="block text-[13px] text-ink-soft">{tile.sub}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
