"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import {
  fetchActiveStaff,
  fetchActiveCleaningTasks,
  fetchTodayCleaningLogs,
} from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

type Session = "open" | "close";

function defaultSession(): Session {
  return new Date().getHours() < 14 ? "open" : "close";
}

export default function CleaningLogPage() {
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: tasks } = useCachedQuery(`cd-cleaning-tasks:${site.id}`, () => fetchActiveCleaningTasks(site.id));
  const { data: todayLogs } = useCachedQuery(`cd-today-cleaning-logs:${site.id}`, () => fetchTodayCleaningLogs(site.id));

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [session, setSession] = useState<Session>(defaultSession());
  // Ticks made this visit — the server list (todayLogs) refreshes on its own
  // schedule, so completed state is the union of both.
  const [tickedNow, setTickedNow] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

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
    const recordedAt = new Date().toISOString();
    try {
      const clientId = await queueEntry("cleaning_logs", {
        staff_id: staffId,
        task_id: taskId,
        session,
        recorded_at: recordedAt,
      });
      appendToTodayCache(`cd-today-cleaning-logs:${site.id}`, {
        id: clientId,
        task_id: taskId,
        session,
        recorded_at: recordedAt,
      });
      void syncOutbox().catch(() => {});
      setSaveError(null);
      setTickedNow((prev) => new Set(prev).add(`${session}:${taskId}`));
    } catch (err) {
      setSaveError(`Could not save: ${err instanceof Error ? err.message : "unknown error"}`);
      throw err;
    }
  }

  async function tickAllRemaining() {
    try {
      for (const task of remaining) {
        await tickTask(task.id);
      }
    } catch {
      // tickTask has already shown the error; stop the run there.
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Cleaning Checklist" />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Which clean?
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {(["open", "close"] as Session[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSession(s)}
                className={`py-3.5 rounded-2xl text-base font-semibold transition-all ${
                  session === s
                    ? "bg-brand text-white shadow-sm"
                    : "bg-surface text-ink border border-line shadow-sm"
                }`}
              >
                {s === "open" ? "🌅 Opening clean" : "🌙 Closing clean"}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Who&apos;s cleaning?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-2.5">
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">
              Tasks — tap when done
            </h2>
            <span className="text-sm text-ink-soft">
              {sessionTasks.length - remaining.length}/{sessionTasks.length} done
            </span>
          </div>

          {!staffId && sessionTasks.length > 0 && (
            <p className="mb-3 text-gold-deep font-semibold text-sm">
              Pick your name first, then tick off tasks.
            </p>
          )}

          {sessionTasks.length === 0 && (
            <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
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
                  onClick={() => void tickTask(task.id).catch(() => {})}
                  className={`w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left text-base font-semibold transition-all active:scale-[0.99] ${
                    done
                      ? "bg-brand-soft text-brand-deep border border-brand/20"
                      : "bg-surface text-ink border border-line shadow-sm disabled:opacity-60"
                  }`}
                >
                  <span
                    className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-sm ${
                      done ? "bg-brand text-white" : "border-2 border-line"
                    }`}
                    aria-hidden
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
              className="mt-4 w-full h-12 rounded-2xl bg-surface border border-brand text-brand font-semibold active:bg-brand-soft"
            >
              Tick all remaining ({remaining.length})
            </button>
          )}

          {sessionTasks.length > 0 && remaining.length === 0 && (
            <div className="mt-4 rounded-2xl bg-brand-soft border border-brand/20 px-4 py-4 text-center">
              <p className="font-bold text-brand-deep text-lg">
                ✓ {session === "open" ? "Opening" : "Closing"} clean complete
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
