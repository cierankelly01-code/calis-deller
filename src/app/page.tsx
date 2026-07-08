"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import {
  fetchActiveFridgeUnits,
  fetchTodayFridgeLogs,
  fetchActiveCleaningTasks,
  fetchTodayCleaningLogs,
} from "@/lib/data/queries";
import { currentSlot, computeUnitSlotStatus } from "@/lib/dashboard/dueStatus";
import { SyncStatusPill } from "@/components/ui/SyncStatusPill";

const LOG_TILES = [
  { href: "/log/fridge", emoji: "🧊", title: "Fridge round", sub: "AM & PM temps" },
  { href: "/log/cooking", emoji: "🍳", title: "Hot food check", sub: "Cook · reheat · hot hold" },
  { href: "/log/delivery", emoji: "🚚", title: "Delivery in", sub: "Van temp & condition" },
  { href: "/log/cleaning", emoji: "🧽", title: "Cleaning", sub: "Opening & closing" },
  { href: "/log/probe", emoji: "🌡️", title: "Probe check", sub: "Weekly calibration" },
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
  const { data: units } = useCachedQuery("cd-fridge-units", fetchActiveFridgeUnits);
  const { data: todayLogs, loading } = useCachedQuery("cd-today-fridge-logs", fetchTodayFridgeLogs);
  const { data: cleaningTasks } = useCachedQuery("cd-cleaning-tasks", fetchActiveCleaningTasks);
  const { data: todayCleaning } = useCachedQuery("cd-today-cleaning-logs", fetchTodayCleaningLogs);

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

  const fridgesDue = statuses.filter((s) => !s.done).length;
  const cleaningDue = cleaning.total > 0 && cleaning.done < cleaning.total;
  const anyOutOfRange = statuses.some((s) => s.inRange === false);
  const allCaughtUp =
    statuses.length > 0 && fridgesDue === 0 && !cleaningDue && !anyOutOfRange;

  return (
    <div className="flex flex-col flex-1">
      <header className="border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className="px-5 py-5 max-w-2xl w-full mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-[28px] font-semibold text-brand-deep leading-tight">
              Cali&apos;s Deller
            </h1>
            <p className="text-sm text-ink-soft">{todayHeading()}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <SyncStatusPill />
            <Link
              href="/settings"
              className="h-11 w-11 flex items-center justify-center rounded-full bg-paper border border-line text-xl active:scale-95 transition-transform"
              aria-label="Settings"
            >
              ⚙️
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-7">
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
