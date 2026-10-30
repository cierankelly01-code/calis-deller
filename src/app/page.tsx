"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { buildJobs, jobsLeft, type Job, type JobTone } from "@/lib/today/jobs";
import { certificatesNeedingAction, trainingByPerson } from "@/lib/training/status";
import { welcomeSeen } from "@/lib/welcome";
import { useRememberedStaff } from "@/lib/staffMemory";
import { useLiveQuery } from "@/lib/data/useLiveQuery";
import { SyncStatusPill } from "@/components/ui/SyncStatusPill";
import { Icon, IconTile, type IconName } from "@/components/ui/Icon";
import { useUser } from "@/components/auth/AuthBoundary";

// The home screen, built so anyone can pick up the iPad and know what to do:
// 1. tap your name, 2. do the next job (one big card, with "How?"),
// 3. something happening? one big button for it. Everything the app did
// before is still one tap away under "All checks and records".

const JOB_ICON: Record<string, IconName> = {
  fridge: "fridge", cleaning: "sparkle", hand_wash: "drop", pest: "bug", probe: "thermometer",
  cooling: "clock", sandwiches: "sandwich", counter: "meat", review: "calendar", training: "cap",
};

const HAPPENING: { href: string; icon: IconName; tone: "green" | "gold" | "red"; title: string; sub: string }[] = [
  { href: "/log/cooking", icon: "flame", tone: "gold", title: "Out of the oven", sub: "Probe it. Starts the 2-hour clock." },
  { href: "/log/delivery", icon: "truck", tone: "green", title: "Delivery in", sub: "Check the van and the food" },
  { href: "/sandwiches", icon: "sandwich", tone: "green", title: "Sandwiches", sub: "Made, put out, taken off" },
  { href: "/allergens", icon: "alert", tone: "gold", title: "Allergy question", sub: "A customer is asking" },
  { href: "/checks?kind=maintenance", icon: "wrench", tone: "green", title: "Something broken", sub: "Fridge, sink, door, light" },
  { href: "/health", icon: "ill", tone: "red", title: "Feeling ill?", sub: "Sick or diarrhoea: stop" },
];

const ALL_CHECKS: { href: string; icon: IconName; title: string; sub: string }[] = [
  { href: "/log/fridge", icon: "fridge", title: "Fridge round", sub: "Morning and afternoon temps" },
  { href: "/log/cooking", icon: "flame", title: "Hot food check", sub: "Cook, reheat, hot hold" },
  { href: "/cooling", icon: "clock", title: "Cooling clock", sub: "Warm food: 2 hours" },
  { href: "/log/delivery", icon: "truck", title: "Delivery in", sub: "Van temp and condition" },
  { href: "/log/cleaning", icon: "sparkle", title: "Cleaning", sub: "Opening and closing" },
  { href: "/log/probe", icon: "thermometer", title: "Probe check", sub: "Weekly accuracy test" },
  { href: "/checks", icon: "drop", title: "Quick checks", sub: "Hand sink, pests, repairs" },
  { href: "/counter", icon: "meat", title: "Counter stock", sub: "Put out, take off, dates" },
  { href: "/sandwiches", icon: "sandwich", title: "Sandwiches", sub: "Counter timer, fridge" },
  { href: "/stock", icon: "box", title: "Stock", sub: "Close count, sold out, week" },
  { href: "/trace", icon: "search", title: "Trace a batch", sub: "Cooked, cooled, sold" },
  { href: "/diary", icon: "calendar", title: "Diary", sub: "Any day's records" },
  { href: "/methods", icon: "book", title: "How to do it", sub: "Our safe methods" },
  { href: "/health", icon: "ill", title: "Fit for work", sub: "The sickness rule" },
  { href: "/review", icon: "list", title: "4-weekly review", sub: "Manager signs" },
  { href: "/training", icon: "cap", title: "Training", sub: "Certificates (manager)" },
];

const TONE: Record<JobTone, { row: string; badge: string; word: string; tile: "red" | "gold" | "green" }> = {
  red: { row: "bg-danger-soft border-danger/30", badge: "bg-danger text-white", word: "Do now", tile: "red" },
  amber: { row: "bg-surface border-gold/60", badge: "bg-gold text-ink", word: "To do", tile: "gold" },
  green: { row: "bg-surface border-line", badge: "bg-brand-soft text-brand-deep", word: "Done", tile: "green" },
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function todayHeading(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function NextJob({ job }: { job: Job }) {
  const red = job.tone === "red";
  return (
    <section className={`rounded-3xl p-5 ${red ? "bg-danger text-white" : "bg-brand text-white"} shadow-sm`}>
      <p className="text-sm font-semibold text-white/80">{red ? "Do this now" : "Your next job"}</p>
      <div className="mt-2 flex items-center gap-3.5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15"><Icon name={JOB_ICON[job.key] ?? "check"} size={30} /></span>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight">{job.title}</p>
          <p className="text-white/85">{job.detail}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2.5">
        <Link href={job.href} className={`flex h-14 items-center justify-center gap-2 rounded-2xl bg-white text-lg font-bold ${red ? "text-danger" : "text-brand-deep"} active:scale-[0.98] transition-transform`}>
          Start <Icon name="arrow" size={20} />
        </Link>
        <Link href={`/methods/${job.method}`} className="flex h-14 items-center gap-2 rounded-2xl border border-white/40 px-4 font-semibold active:scale-[0.98] transition-transform">
          <Icon name="book" size={20} /> How?
        </Link>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const router = useRouter();
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
  // First time on this iPad: show the short tour of how the app works.
  useEffect(() => {
    if (!welcomeSeen()) router.replace("/welcome");
  }, [router]);

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
  const next = jobs.find((j) => j.tone !== "green") ?? null;
  const rest = jobs.filter((j) => j !== next);
  const me = (staff ?? []).find((s) => s.id === staffId) ?? null;
  const choosing = !me || picking;

  return (
    <div className="flex flex-col flex-1">
      <header className="bg-paper">
        <div className="px-5 pt-5 pb-1 max-w-2xl w-full mx-auto flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-soft">{site.short_name} · {todayHeading()}</p>
            <h1 className="font-display text-[30px] font-semibold text-brand-deep leading-tight">
              {me && !picking ? `${greeting()}, ${me.name}` : "Kelly's Deli"}
            </h1>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <SyncStatusPill />
            <Link href="/welcome" className="h-11 w-11 grid place-items-center rounded-full bg-surface border border-line text-ink-soft active:scale-95 transition-transform" aria-label="How this app works"><Icon name="question" /></Link>
            {isManager && <Link href="/settings" className="h-11 w-11 grid place-items-center rounded-full bg-surface border border-line text-ink-soft active:scale-95 transition-transform" aria-label="Settings"><Icon name="cog" /></Link>}
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 pt-3 pb-6 max-w-2xl w-full mx-auto space-y-7">
        {choosing ? (
          <section className="rounded-3xl bg-surface border border-line p-5">
            <div className="flex items-center gap-3 mb-4">
              <IconTile name="user" />
              <div>
                <p className="text-xl font-bold text-ink">Who&apos;s working?</p>
                <p className="text-sm text-ink-soft">Tap your name. The app writes it on every check you do.</p>
              </div>
            </div>
            {(staff ?? []).length === 0 ? <p className="text-ink-soft">No staff set up yet. A manager adds them in Settings, Staff.</p> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {(staff ?? []).map((s) => (
                  <button key={s.id} type="button" onClick={() => { setStaffId(s.id); setPicking(false); }} className={`h-16 rounded-2xl text-lg font-semibold active:scale-95 transition-transform ${s.id === staffId ? "bg-brand text-white" : "bg-paper text-ink"}`}>{s.name}</button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <button type="button" onClick={() => setPicking(true)} className="-mt-4 min-h-11 px-1 text-sm font-semibold text-brand underline underline-offset-2">Not {me.name}? Change name</button>
        )}

        {next ? (
          <NextJob job={next} />
        ) : jobs.length > 0 && (
          <section className="rounded-3xl bg-brand-soft p-5 flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand text-white"><Icon name="check" size={30} strokeWidth={2.5} /></span>
            <div>
              <p className="text-xl font-bold text-brand-deep">All done for now</p>
              <p className="text-ink-soft">Every check that&apos;s due is recorded. Nice one.</p>
            </div>
          </section>
        )}

        {rest.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-2.5">
              <h2 className="section-title">The rest of today</h2>
              <p className={`text-sm font-semibold ${left === 0 ? "text-brand" : "text-ink-soft"}`}>{left === 0 ? "All done" : `${left} still to do`}</p>
            </div>
            <div className="rounded-2xl bg-surface border border-line divide-y divide-line overflow-hidden">
              {rest.map((job) => {
                const tone = TONE[job.tone];
                return (
                  <div key={job.key} className={`flex items-center ${job.tone === "red" ? "bg-danger-soft" : ""}`}>
                    <Link href={job.href} className="flex-1 flex items-center gap-3 px-4 py-3 min-w-0 active:bg-paper">
                      <IconTile name={JOB_ICON[job.key] ?? "check"} tone={tone.tile} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink leading-tight">{job.title}</span>
                        <span className="block text-sm text-ink-soft truncate">{job.detail}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${tone.badge}`}>{job.tone === "green" ? "✓ Done" : tone.word}</span>
                    </Link>
                    <Link href={`/methods/${job.method}`} className="h-full px-3.5 py-4 text-brand-deep border-l border-line" aria-label={`How to: ${job.title}`}><Icon name="book" size={20} /></Link>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-ink-soft flex items-center gap-1.5"><Icon name="book" size={16} /> = how to do it, step by step</p>
          </section>
        )}

        <section>
          <h2 className="section-title mb-2.5">Something happening?</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {HAPPENING.map((tile) => (
              <Link key={tile.title} href={tile.href} className="rounded-2xl bg-surface border border-line p-4 active:scale-[0.98] transition-transform">
                <IconTile name={tile.icon} tone={tile.tone} />
                <span className="block mt-2.5 font-bold text-ink leading-tight">{tile.title}</span>
                <span className="block text-[13px] text-ink-soft mt-0.5">{tile.sub}</span>
              </Link>
            ))}
          </div>
        </section>

        <Link href="/inspector" className="flex items-center gap-4 rounded-3xl bg-ink text-paper px-5 py-4 active:scale-[0.99] transition-transform">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-paper/10"><Icon name="shield" size={26} /></span>
          <span className="flex-1">
            <span className="block text-lg font-bold">Inspector here?</span>
            <span className="block text-sm text-paper/75">Press this and hand them the iPad</span>
          </span>
          <Icon name="chevron" className="text-paper/50" />
        </Link>

        <section>
          <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="w-full flex items-center justify-between rounded-2xl bg-surface border border-line px-5 py-4 font-bold text-ink">
            <span className="flex items-center gap-3"><IconTile name="list" tone="plain" size="sm" /> All checks and records</span>
            <Icon name="chevron" className={`text-ink-faint transition-transform ${showAll ? "rotate-90" : ""}`} />
          </button>
          {showAll && (
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              {ALL_CHECKS.map((tile) => (
                <Link key={tile.href} href={tile.href} className="flex items-center gap-3 rounded-2xl bg-surface border border-line p-3.5 active:scale-[0.98] transition-transform">
                  <IconTile name={tile.icon} size="sm" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink leading-tight">{tile.title}</span>
                    <span className="block text-xs text-ink-soft">{tile.sub}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
