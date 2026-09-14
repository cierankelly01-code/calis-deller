"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSite } from "@/lib/site/SiteContext";

// Generic add/remove manager for config tables that are just an ordered
// list of names (staff, suppliers). "Remove" deactivates — config rows are
// never deleted so historic logs keep resolving (see 0001_init.sql).

type NamedRow = { id: string; name: string; sort_order: number };

type SimpleNameListManagerProps = {
  table: "staff" | "suppliers";
  cacheKey: string; // localStorage key prefix used by useCachedQuery elsewhere (site-suffixed) — cleared on change
  addLabel: string;
  placeholder: string;
};

export function SimpleNameListManager({
  table,
  cacheKey,
  addLabel,
  placeholder,
}: SimpleNameListManagerProps) {
  const { site } = useSite();
  const [rows, setRows] = useState<NamedRow[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = () =>
    supabase.from(table).select("id, name, sort_order").eq("site_id", site.id).eq("active", true).order("sort_order");

  function applyResult({ data, error: fetchError }: Awaited<ReturnType<typeof fetchRows>>) {
    if (fetchError) {
      setError("Couldn't load — check the internet connection.");
      return;
    }
    setRows(data ?? []);
    // Pickers elsewhere cache under this key; force them to refetch.
    window.localStorage.removeItem(`${cacheKey}:${site.id}`);
  }

  async function refresh() {
    applyResult(await fetchRows());
  }

  useEffect(() => {
    fetchRows().then(applyResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

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

  function add() {
    const name = newName.trim();
    if (!name) return;
    const nextSort = Math.max(0, ...(rows ?? []).map((r) => r.sort_order)) + 1;
    run(() => supabase.from(table).insert({ site_id: site.id, name, sort_order: nextSort }));
    setNewName("");
  }

  function remove(id: string) {
    run(() => supabase.from(table).update({ active: false }).eq("id", id));
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-danger font-medium">{error}</p>}
      {rows === null && !error && <p className="text-ink-faint">Loading…</p>}

      <div className="space-y-2">
        {(rows ?? []).map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between rounded-xl bg-surface border border-line px-4 py-3"
          >
            <p className="font-semibold text-ink">{row.name}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(row.id)}
              className="text-sm font-semibold text-danger disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={placeholder}
          className="flex-1 h-12 rounded-xl border border-line px-3 text-base"
        />
        <button
          type="button"
          disabled={busy || newName.trim() === ""}
          onClick={add}
          className="h-12 px-5 rounded-xl bg-brand text-white font-semibold disabled:opacity-40"
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}
