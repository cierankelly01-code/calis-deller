"use client";

import Link from "next/link";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import {
  fetchActiveFridgeUnits,
  fetchTodayFridgeLogs,
  fetchActiveCleaningTasks,
  fetchTodayCleaningLogs,
} from "@/lib/data/queries";
import { computeFridgeUnitStatus } from "@/lib/dashboard/dueStatus";
import { UnsyncedBadge } from "@/components/ui/UnsyncedBadge";

const LOG_TILES = [
  { href: "/log/fridge", emoji: "🧊", title: "Fridge check", sub: "AM & PM temperatures" },
  { href: "/log/cooking", emoji: "🍳", title: "Cooking check", sub: "Out-of-oven temps" },
  { href: "/log/delivery", emoji: "🚚", title: "Delivery in", sub: "Van temp & condition" },
  { href: "/log/cleaning", emoji: "🧽", title: "Cleaning", sub: "Opening & closing" },
  { href: "/log/probe", emoji: "🌡️", title: "Probe check", sub: "Weekly calibration" },
  { href: "/diary", emoji: "📖", title: "Diary", sub: "Any day's records" },
] as const;

export default function DashboardPage() {
  const { data: units } = useCachedQuery("cd-fridge-units", fetchActiveFridgeUnits);
  const { data: todayLogs, loading } = useCachedQuery("cd-today-fridge-logs", fetchTodayFridgeLogs);
  const { data: cleaningTasks } = useCachedQuery("cd-cleaning-tasks", fetchActiveCleaningTasks);
  const { data: todayCleaning } = useCachedQuery("cd-today-cleaning-logs", fetchTodayCleaningLogs);

  const statuses = computeFridgeUnitStatus(units ?? [], todayLogs ?? []);

  const cleaningStatus = (["open", "close"] as const).map((session) => {
    const total = (cleaningTasks ?? []).filter(
      (t) => t.session === session || t.session === "both"
    ).length;
    const done = new Set(
      (todayCleaning ?? []).filter((l) => l.session === session).map((l) => l.task_id)
    ).size;
    return { session, total, done };
  });

  return (
    <div className="flex flex-col flex-1">
      <div className="px-4 py-6 bg-white border-b border-zinc-200 flex items-center justify-between max-w-full">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Cali&apos;s Deller</h1>
          <p className="text-zinc-500">Food safety diary</p>
        </div>
        <Link
          href="/settings"
          className="h-11 w-11 flex items-center justify-center rounded-full bg-zinc-100 text-xl"
          aria-label="Settings"
        >
          ⚙️
        </Link>
      </div>
      <UnsyncedBadge />

      <div className="flex-1 px-4 py-6 max-w-2xl w-full mx-auto space-y-7">
        <Link
          href="/allergens"
          className="flex items-center gap-4 rounded-2xl bg-amber-400 px-5 py-5 shadow-sm active:scale-[0.99]"
        >
          <span className="text-4xl">⚠️</span>
          <span>
            <span className="block text-lg font-bold text-amber-950">Allergen Guide</span>
            <span className="block text-sm text-amber-900">
              Customer asking? Search any product for its 14-allergen info
            </span>
          </span>
        </Link>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Today at a glance
          </h2>

          {loading && statuses.length === 0 && <p className="text-zinc-400">Loading…</p>}

          {!loading && statuses.length === 0 && (
            <p className="text-zinc-500">
              No fridge units set up yet —{" "}
              <Link href="/settings/units" className="text-teal-700 font-semibold underline">
                add them in Settings
              </Link>
              .
            </p>
          )}

          <div className="space-y-2">
            {statuses.map((status) => (
              <Link
                key={status.unitId}
                href="/log/fridge"
                className="flex items-center justify-between rounded-xl bg-white border border-zinc-200 px-4 py-3 active:scale-[0.99]"
              >
                <div>
                  <p className="font-semibold text-zinc-900">{status.unitName}</p>
                  <p className="text-sm text-zinc-500">
                    <span className={status.amDone ? "text-teal-700" : "text-amber-600 font-medium"}>
                      AM {status.amDone ? "✓" : "due"}
                    </span>
                    {" · "}
                    <span className={status.pmDone ? "text-teal-700" : "text-amber-600 font-medium"}>
                      PM {status.pmDone ? "✓" : "due"}
                    </span>
                  </p>
                </div>
                {status.lastOutOfRange && (
                  <span className="text-red-600 text-sm font-semibold">⚠ out of range</span>
                )}
              </Link>
            ))}

            {cleaningStatus.map(({ session, total, done }) =>
              total === 0 ? null : (
                <Link
                  key={session}
                  href="/log/cleaning"
                  className="flex items-center justify-between rounded-xl bg-white border border-zinc-200 px-4 py-3 active:scale-[0.99]"
                >
                  <p className="font-semibold text-zinc-900">
                    {session === "open" ? "🌅 Opening clean" : "🌙 Closing clean"}
                  </p>
                  <p
                    className={`text-sm font-semibold ${
                      done >= total ? "text-teal-700" : "text-amber-600"
                    }`}
                  >
                    {done >= total ? "✓ complete" : `${done}/${total} done`}
                  </p>
                </Link>
              )
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Record a check
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {LOG_TILES.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                className="rounded-2xl bg-white border border-zinc-200 shadow-sm px-4 py-5 active:scale-[0.98]"
              >
                <span className="text-3xl">{tile.emoji}</span>
                <span className="block mt-2 font-bold text-zinc-900">{tile.title}</span>
                <span className="block text-sm text-zinc-500">{tile.sub}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
