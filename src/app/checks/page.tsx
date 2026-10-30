"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { HowLink } from "@/components/ui/HowLink";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchSiteChecks, type SiteCheck } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import type { SiteCheckKind } from "@/types/database";

// Three quick SFBB checks with nowhere else to live: the hand sink (daily),
// signs of pests (weekly) and anything broken (whenever it happens). A
// problem must say what was done about it, like every other check.

const KINDS: Record<SiteCheckKind, { emoji: string; title: string; ask: string; yes: string; no: string; method: string; placeholder: string }> = {
  hand_wash: { emoji: "🧼", title: "Hand sink", ask: "Is there soap, hot water and paper towels, and nothing else in the sink?", yes: "Yes, all OK", no: "No, there's a problem", method: "hand-washing", placeholder: "e.g. no paper towels: refilled from the store room" },
  pest: { emoji: "🐭", title: "Pests", ask: "Any droppings, gnawed packs, insects or holes where pests could get in?", yes: "No signs", no: "Yes, I found something", method: "pest-control", placeholder: "e.g. droppings behind the flour: binned the open bags, cleaned, called pest control" },
  maintenance: { emoji: "🔧", title: "Something broken", ask: "Is everything working: fridges, sinks, doors, lights, surfaces?", yes: "All working", no: "Something's broken", method: "maintenance", placeholder: "e.g. fridge door seal split: told the manager, food moved to the other fridge" },
};

function initialKind(): SiteCheckKind {
  if (typeof window === "undefined") return "hand_wash";
  const k = new URLSearchParams(window.location.search).get("kind");
  return k === "pest" || k === "maintenance" || k === "hand_wash" ? k : "hand_wash";
}

export default function SiteChecksPage() {
  const { site } = useSite();
  const cacheKey = `cd-site-checks:${site.id}`;
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: checks } = useCachedQuery(cacheKey, () => fetchSiteChecks(site.id));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [kind, setKind] = useState<SiteCheckKind>(initialKind);
  const [ok, setOk] = useState<boolean | null>(null);
  const [action, setAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [local, setLocal] = useState<SiteCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const info = KINDS[kind];
  const recent = useMemo(() => [...local, ...(checks ?? [])].filter((c) => c.kind === kind).slice(0, 8), [local, checks, kind]);
  const name = (id: string) => (staff ?? []).find((s) => s.id === id)?.name ?? "";

  const canSave = !!staffId && ok !== null && (ok || action.trim().length > 0) && !saving;
  const hint = !staffId ? "Tap who's checking first" : ok === null ? "Answer the question" : !ok && !action.trim() ? "Say what you did about it" : null;

  async function save() {
    if (!canSave || !staffId || ok === null) return;
    setSaving(true);
    setError(null);
    try {
      const row = { staff_id: staffId, kind, ok, corrective_action: ok ? null : action.trim(), recorded_at: new Date().toISOString() };
      const id = await queueEntry("site_check_logs", row);
      const saved: SiteCheck = { id, ...row };
      setLocal((l) => [saved, ...l]);
      appendToTodayCache(cacheKey, saved);
      void syncOutbox().catch(() => {});
      setShowSaved(true);
      setTimeout(() => { setShowSaved(false); setOk(null); setAction(""); }, 650);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Quick checks" />
      <SavedOverlay show={showSaved} message={`${info.title} check saved`} />
      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <div role="tablist" className="grid grid-cols-3 gap-2">
          {(Object.keys(KINDS) as SiteCheckKind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} onClick={() => { setKind(k); setOk(null); setAction(""); }} className={`py-3 rounded-2xl font-semibold ${k === kind ? "bg-brand text-white" : "bg-surface border border-line text-ink"}`}>
              <span className="block text-2xl" aria-hidden>{KINDS[k].emoji}</span>{KINDS[k].title}
            </button>
          ))}
        </div>
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Who&apos;s checking?</h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>
        <section className="space-y-3">
          <p className="text-xl font-bold text-ink leading-snug">{info.ask}</p>
          <HowLink method={info.method} />
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setOk(true)} className={`h-20 rounded-2xl text-lg font-bold ${ok === true ? "bg-brand text-white" : "bg-surface border border-line"}`}>✓ {info.yes}</button>
            <button type="button" onClick={() => setOk(false)} className={`h-20 rounded-2xl text-lg font-bold ${ok === false ? "bg-danger text-white" : "bg-surface border border-line"}`}>✗ {info.no}</button>
          </div>
          {kind === "pest" && ok === true && <p className="text-sm text-ink-soft">Look behind and under: dry stores, the back door, under the counters, around the bins.</p>}
        </section>
        {ok === false && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">What did you do about it?</h2>
            <textarea maxLength={2000} value={action} onChange={(e) => setAction(e.target.value)} placeholder={info.placeholder} className="w-full rounded-2xl border border-line bg-surface p-3.5 text-base min-h-24 placeholder:text-ink-faint focus:outline-none focus:border-brand" />
            <p className="mt-2 text-sm text-ink-soft">Tell the manager straight away.</p>
          </section>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {recent.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Last checks</h2>
            <div className="space-y-2">
              {recent.map((c) => (
                <div key={c.id} className={`rounded-xl border px-4 py-2.5 text-sm ${c.ok ? "bg-surface border-line" : "bg-danger-soft border-danger/30"}`}>
                  {new Date(c.recorded_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {c.ok ? "OK" : "Problem"} · {name(c.staff_id)}
                  {c.corrective_action && <span className="block text-danger">Action: {c.corrective_action}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <SaveBar disabled={!canSave} saving={saving} saved={false} onSave={save} hint={hint} />
    </div>
  );
}
