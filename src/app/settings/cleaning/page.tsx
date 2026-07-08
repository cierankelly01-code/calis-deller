"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { supabase } from "@/lib/supabase/client";
import type { CleaningTaskRow } from "@/types/database";

type Session = "open" | "close" | "both";

const SESSION_LABELS: Record<Session, string> = {
  open: "🌅 Opening",
  close: "🌙 Closing",
  both: "Both",
};

export default function CleaningSettingsPage() {
  const [tasks, setTasks] = useState<CleaningTaskRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [session, setSession] = useState<Session>("both");

  const fetchTasks = () =>
    supabase.from("cleaning_tasks").select("*").eq("active", true).order("sort_order");

  function applyResult({ data, error: fetchError }: Awaited<ReturnType<typeof fetchTasks>>) {
    if (fetchError) {
      setError("Couldn't load — check the internet connection.");
      return;
    }
    setTasks(data ?? []);
    window.localStorage.removeItem("cd-cleaning-tasks");
  }

  async function refresh() {
    applyResult(await fetchTasks());
  }

  useEffect(() => {
    fetchTasks().then(applyResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError(null);
    try {
      const { error: writeError } = await action();
      if (writeError) throw writeError;
      await refresh();
    } catch {
      setError("Couldn't save — check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function addTask() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const nextSort = Math.max(0, ...(tasks ?? []).map((t) => t.sort_order)) + 1;
    run(() =>
      supabase.from("cleaning_tasks").insert({ name: trimmed, session, sort_order: nextSort })
    );
    setName("");
  }

  function removeTask(id: string) {
    run(() => supabase.from("cleaning_tasks").update({ active: false }).eq("id", id));
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Cleaning Tasks" backHref="/settings" />
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-2xl w-full mx-auto space-y-6">
        <p className="text-sm text-ink-soft">
          These make up the opening and closing checklists. Removing a task hides it — past
          ticks are kept.
        </p>

        {error && <p className="text-danger font-medium">{error}</p>}
        {tasks === null && !error && <p className="text-ink-faint">Loading…</p>}

        <div className="space-y-2">
          {(tasks ?? []).map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-surface border border-line px-4 py-3"
            >
              <div>
                <p className="font-semibold text-ink">{task.name}</p>
                <p className="text-sm text-ink-soft">{SESSION_LABELS[task.session]}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeTask(task.id)}
                className="text-sm font-semibold text-danger disabled:opacity-40 shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <section className="rounded-xl bg-surface border border-line p-4 space-y-4">
          <h2 className="font-bold text-ink">Add a task</h2>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
            placeholder="e.g. Descale coffee machine"
            className="w-full h-12 rounded-xl border border-line px-3 text-base"
          />

          <div className="grid grid-cols-3 gap-2">
            {(["open", "close", "both"] as Session[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSession(s)}
                className={`h-12 rounded-xl text-sm font-semibold transition-colors ${
                  session === s ? "bg-brand text-white" : "bg-paper text-ink-soft"
                }`}
              >
                {SESSION_LABELS[s]}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={busy || name.trim() === ""}
            onClick={addTask}
            className="w-full h-12 rounded-xl bg-brand text-white font-semibold disabled:opacity-40"
          >
            Add task
          </button>
        </section>
      </div>
    </div>
  );
}
