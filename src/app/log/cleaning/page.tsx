"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { UnsyncedBadge } from "@/components/ui/UnsyncedBadge";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import {
  fetchActiveStaff,
  fetchActiveCleaningTasks,
  fetchTodayCleaningLogs,
} from "@/lib/data/queries";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

type Session = "open" | "close";

function defaultSession(): Session {
  return new Date().getHours() < 14 ? "open" : "close";
}

export default function CleaningLogPage() {
  const { data: staff } = useCachedQuery("cd-staff", fetchActiveStaff);
  const { data: tasks } = useCachedQuery("cd-cleaning-tasks", fetchActiveCleaningTasks);
  const { data: todayLogs } = useCachedQuery("cd-today-cleaning-logs", fetchTodayCleaningLogs);

  const [staffId, setStaffId] = useState<string | null>(null);
  const [session, setSession] = useState<Session>(defaultSession());
  // Ticks made this visit — the server list (todayLogs) refreshes on its own
  // schedule, so completed state is the union of both.
  const [tickedNow, setTickedNow] = useState<Set<string>>(new Set());

  const sessionTasks = useMemo(
    () => (tasks ?? []).filter((t) => t.session === session || t.session === "both"),
    [tasks, session]
  );

  const doneFromServer = useMemo(() => {
    const done = new Set<string>();
    for (const log of todayLogs ?? []) {
      if (log.session === session) done.add(log.task_id);
    }
    return done;
  }, [todayLogs, session]);

  function isDone(taskId: string) {
    return tickedNow.has(`${session}:${taskId}`) || doneFromServer.has(taskId);
  }

  const remaining = sessionTasks.filter((t) => !isDone(t.id));

  async function tickTask(taskId: string) {
    if (!staffId || isDone(taskId)) return;
    await queueEntry("cleaning_logs", {
      staff_id: staffId,
      task_id: taskId,
      session,
      recorded_at: new Date().toISOString(),
    });
    syncOutbox();
    setTickedNow((prev) => new Set(prev).add(`${session}:${taskId}`));
  }

  async function tickAllRemaining() {
    for (const task of remaining) {
      await tickTask(task.id);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Cleaning Checklist" />
      <UnsyncedBadge />

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Which clean?
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(["open", "close"] as Session[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSession(s)}
                className={`h-14 rounded-xl text-base font-semibold transition-colors ${
                  session === s
                    ? "bg-teal-700 text-white"
                    : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
                }`}
              >
                {s === "open" ? "🌅 Opening clean" : "🌙 Closing clean"}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Who&apos;s cleaning?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
              Tasks — tap when done
            </h2>
            <span className="text-sm text-zinc-500">
              {sessionTasks.length - remaining.length}/{sessionTasks.length} done
            </span>
          </div>

          {!staffId && sessionTasks.length > 0 && (
            <p className="mb-3 text-amber-600 font-medium text-sm">
              Pick your name first, then tick off tasks.
            </p>
          )}

          {sessionTasks.length === 0 && (
            <p className="text-zinc-500">
              No cleaning tasks set up for this session — add them in Settings.
            </p>
          )}

          <div className="space-y-2">
            {sessionTasks.map((task) => {
              const done = isDone(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  disabled={done || !staffId}
                  onClick={() => tickTask(task.id)}
                  className={`w-full flex items-center gap-3 rounded-xl px-4 py-4 text-left text-base font-semibold transition-colors active:scale-[0.99] ${
                    done
                      ? "bg-teal-50 text-teal-800 border border-teal-200"
                      : "bg-white text-zinc-900 border border-zinc-200 shadow-sm disabled:opacity-60"
                  }`}
                >
                  <span
                    className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-sm ${
                      done ? "bg-teal-600 text-white" : "border-2 border-zinc-300"
                    }`}
                  >
                    {done ? "✓" : ""}
                  </span>
                  {task.name}
                </button>
              );
            })}
          </div>

          {staffId && remaining.length > 1 && (
            <button
              type="button"
              onClick={tickAllRemaining}
              className="mt-4 w-full h-12 rounded-xl bg-white border border-teal-700 text-teal-700 font-semibold"
            >
              Tick all remaining ({remaining.length})
            </button>
          )}

          {sessionTasks.length > 0 && remaining.length === 0 && (
            <p className="mt-4 text-center text-teal-700 font-semibold text-lg">
              ✓ {session === "open" ? "Opening" : "Closing"} clean complete
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
