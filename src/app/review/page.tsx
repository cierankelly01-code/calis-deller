"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { HowLink } from "@/components/ui/HowLink";
import { useUser } from "@/components/auth/AuthBoundary";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchAllStaff, fetchReviews, type ReviewLog } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { formatDate } from "@/lib/methods/records";

// The SFBB 4-weekly review: look back over the last four weeks, say what
// changed and what went wrong, and what you're doing about it. A manager
// signs it. If something changed, the safe methods it touches get checked.

const CHANGES: { id: string; label: string }[] = [
  { id: "staff", label: "New staff" },
  { id: "suppliers", label: "New suppliers" },
  { id: "menu", label: "New food or recipes" },
  { id: "equipment", label: "New or broken equipment" },
  { id: "chemicals", label: "New cleaning products" },
  { id: "methods", label: "New ways of working" },
  { id: "premises", label: "Building work or repairs" },
];

const QUESTIONS = [
  "Have the daily checks been done every day?",
  "Has every problem got a note of what was done?",
  "Have all staff been shown the safe methods for their jobs?",
  "Do the safe methods still match how we work?",
];

export default function ReviewPage() {
  const user = useUser();
  const { site } = useSite();
  const cacheKey = `cd-reviews:${site.id}`;
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: allStaff } = useCachedQuery(`cd-all-staff:${site.id}`, () => fetchAllStaff(site.id));
  const { data: reviews } = useCachedQuery(cacheKey, () => fetchReviews(site.id));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [local, setLocal] = useState<ReviewLog[]>([]);
  const [changes, setChanges] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const [problems, setProblems] = useState("");
  const [actions, setActions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = useMemo(() => [...local, ...(reviews ?? [])], [local, reviews]);
  const name = (id: string) => (allStaff ?? []).find((s) => s.id === id)?.name ?? "";
  const answered = QUESTIONS.every((_, i) => answers[i] !== undefined);
  const allOk = answered && QUESTIONS.every((_, i) => answers[i]) && problems.trim().length === 0;
  const isManager = user?.role === "manager";
  const canSave = isManager && !!staffId && answered && (allOk || problems.trim().length > 0) && !saving;

  async function save() {
    if (!canSave || !staffId) return;
    setSaving(true);
    setError(null);
    try {
      const failed = QUESTIONS.filter((_, i) => !answers[i]).map((q) => `No: ${q}`);
      const text = [...failed, problems.trim()].filter(Boolean).join("\n");
      const row = { staff_id: staffId, changes, all_ok: allOk, problems: text || null, actions: actions.trim() || null, recorded_at: new Date().toISOString() };
      const id = await queueEntry("review_logs", row);
      const saved: ReviewLog = { id, ...row };
      setLocal((l) => [saved, ...l]);
      appendToTodayCache(cacheKey, saved);
      void syncOutbox().catch(() => {});
      setChanges([]); setAnswers({}); setProblems(""); setActions("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="4-weekly review" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        <div className="rounded-2xl bg-brand-soft border border-brand/20 px-5 py-4">
          <p className="font-bold text-brand-deep">Every 4 weeks, a manager looks back</p>
          <p className="mt-1 text-sm text-ink-soft">Open the <Link href="/diary" className="underline">diary</Link> for the last 4 weeks first. {all[0] ? `Last review: ${formatDate(all[0].recorded_at)} by ${name(all[0].staff_id)}.` : "No review yet."}</p>
          <div className="mt-3"><HowLink method="four-weekly-review" /></div>
        </div>
        {!isManager ? <p className="text-ink-soft">A manager signs the review. Ask them to sign in.</p> : (
          <>
            <section className="space-y-3">
              {QUESTIONS.map((q, i) => (
                <div key={i} className="rounded-2xl bg-surface border border-line px-4 py-3">
                  <p className="font-semibold text-ink">{q}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setAnswers({ ...answers, [i]: true })} className={`h-11 rounded-xl font-semibold ${answers[i] === true ? "bg-brand text-white" : "bg-paper border border-line"}`}>Yes</button>
                    <button type="button" onClick={() => setAnswers({ ...answers, [i]: false })} className={`h-11 rounded-xl font-semibold ${answers[i] === false ? "bg-danger text-white" : "bg-paper border border-line"}`}>No</button>
                  </div>
                </div>
              ))}
            </section>
            <section>
              <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Anything changed in the last 4 weeks?</h2>
              <div className="flex flex-wrap gap-2">
                {CHANGES.map((c) => {
                  const on = changes.includes(c.id);
                  return <button key={c.id} type="button" onClick={() => setChanges(on ? changes.filter((x) => x !== c.id) : [...changes, c.id])} className={`h-11 rounded-full px-4 font-semibold ${on ? "bg-brand text-white" : "bg-surface border border-line"}`}>{c.label}</button>;
                })}
              </div>
              {changes.length > 0 && <p className="mt-2 text-sm text-gold-deep">Check the safe methods these touch, and sign them off again if anything&apos;s different.</p>}
            </section>
            <label className="block font-semibold">Problems this month{!allOk && answered && <span className="text-danger"> (say what went wrong)</span>}
              <textarea maxLength={1500} value={problems} onChange={(e) => setProblems(e.target.value)} placeholder="e.g. fridge 2 too warm twice; the seal is being replaced" className="mt-1 w-full rounded-2xl border border-line bg-surface p-3.5 font-normal min-h-20 focus:outline-none focus:border-brand" />
            </label>
            <label className="block font-semibold">What we&apos;re doing about it
              <textarea maxLength={2000} value={actions} onChange={(e) => setActions(e.target.value)} className="mt-1 w-full rounded-2xl border border-line bg-surface p-3.5 font-normal min-h-20 focus:outline-none focus:border-brand" />
            </label>
            <section>
              <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Manager signing</h2>
              <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
            </section>
            {error && <p role="alert" className="text-danger">{error}</p>}
            <button type="button" disabled={!canSave} onClick={save} className="w-full h-14 rounded-2xl bg-brand text-white text-lg font-bold disabled:opacity-40">{saving ? "Saving…" : "Sign the review"}</button>
          </>
        )}
        {all.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Past reviews</h2>
            <div className="space-y-2">
              {all.map((r) => (
                <div key={r.id} className={`rounded-xl border px-4 py-3 text-sm ${r.all_ok ? "bg-surface border-line" : "bg-gold-soft border-gold/50"}`}>
                  <p className="font-semibold">{formatDate(r.recorded_at)} · {name(r.staff_id)} · {r.all_ok ? "All OK" : "Problems found"}</p>
                  {r.changes.length > 0 && <p>Changed: {r.changes.map((c) => CHANGES.find((x) => x.id === c)?.label ?? c).join(", ")}</p>}
                  {r.problems && <p className="whitespace-pre-line">Problems: {r.problems}</p>}
                  {r.actions && <p>Action: {r.actions}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
