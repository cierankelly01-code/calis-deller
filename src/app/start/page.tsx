"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { Icon, IconTile } from "@/components/ui/Icon";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchInductions, fetchMethodRecords, type InductionLog } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { findMethod } from "@/lib/methods/content";
import { methodIcon } from "@/lib/methods/icons";
import { currentSignOffs, formatDate } from "@/lib/methods/records";
import { APP_TOUR, REQUIRED_READING, inductionProgress, readingTitle } from "@/lib/training/induction";
import { QUIZ, QUIZ_ID } from "@/lib/training/quiz";
import { Quiz } from "@/components/training/Quiz";

// Staff training, done on the iPad: each person reads the safe methods
// everyone must know, one at a time, and confirms "I've read and understood
// this". Each confirmation is saved under their name with the time, so the
// manager (and an inspector) can see who has been trained on what.

export default function StartPage() {
  const { site } = useSite();
  const cacheKey = `cd-inductions:${site.id}`;
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: logs } = useCachedQuery(cacheKey, () => fetchInductions(site.id));
  const { data: records } = useCachedQuery(`cd-method-records:${site.id}`, () => fetchMethodRecords(site.id));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [local, setLocal] = useState<InductionLog[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => [...local, ...(logs ?? [])], [local, logs]);
  const progress = useMemo(() => (staffId ? inductionProgress(all, staffId) : null), [all, staffId]);
  const ourWay = useMemo(() => currentSignOffs(records ?? []), [records]);
  const me = (staff ?? []).find((s) => s.id === staffId) ?? null;
  const currentId = picked ?? progress?.nextId ?? null;
  const method = currentId && currentId !== APP_TOUR ? findMethod(currentId) : undefined;

  async function confirm(itemId: string | null = currentId) {
    if (!staffId || !itemId) return;
    setSaving(true);
    setError(null);
    try {
      const row = { staff_id: staffId, method_id: itemId, recorded_at: new Date().toISOString() };
      const id = await queueEntry("induction_logs", row);
      const saved: InductionLog = { id, ...row };
      setLocal((l) => [saved, ...l]);
      appendToTodayCache(cacheKey, saved);
      void syncOutbox().catch(() => {});
      setPicked(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Your training" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        {!me ? (
          <section className="space-y-3">
            <p className="text-xl font-bold text-ink">Who&apos;s doing their training?</p>
            <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
          </section>
        ) : (
          <>
            <section className="rounded-3xl bg-surface border border-line p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-ink-soft">Training for</p>
                  <p className="text-2xl font-bold text-ink">{me.name}</p>
                </div>
                <button type="button" onClick={() => { setStaffId(""); setPicked(null); }} className="min-h-11 px-2 text-sm font-semibold text-brand underline underline-offset-2">Not you?</button>
              </div>
              <div className="mt-4 h-3 rounded-full bg-paper overflow-hidden">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <p className="mt-2 text-sm font-semibold text-ink-soft">{progress?.done ?? 0} of {progress?.total ?? REQUIRED_READING.length} read · quiz {progress?.quizPassedAt ? "passed ✓" : "to do"}</p>
            </section>

            {progress?.complete && !picked ? (
              <section className="rounded-3xl bg-brand text-white p-6 text-center">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15"><Icon name="check" size={34} strokeWidth={2.5} /></span>
                <p className="mt-3 text-2xl font-bold">Training done. Well done, {me.name}.</p>
                <p className="mt-1 text-white/85">Finished {progress.completedAt ? formatDate(progress.completedAt) : "today"}. The manager can see it in Training. You can re-read any of these whenever you like.</p>
                <Link href="/" className="mt-4 inline-flex h-12 items-center rounded-2xl bg-white px-6 font-bold text-brand-deep">Go to today&apos;s jobs</Link>
              </section>
            ) : progress?.readingDone && !progress.quizPassedAt && !picked ? (
              <section className="space-y-3">
                <div className="rounded-3xl bg-gold-soft border-2 border-gold/60 p-5">
                  <p className="text-xl font-bold text-ink">Last step: a quick quiz</p>
                  <p className="mt-1 text-ink">{QUIZ.length} questions on what you&apos;ve just read. Get one wrong and you&apos;ll see the right answer, then it comes back later. You finish when they&apos;re all right.</p>
                </div>
                {error && <p role="alert" className="text-danger">{error}</p>}
                <Quiz onPass={() => confirm(QUIZ_ID)} saving={saving} />
              </section>
            ) : currentId && (
              <section className="rounded-3xl bg-surface border-2 border-brand/30 p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <IconTile name={method ? methodIcon(method.id, method.group) : "question"} size="lg" />
                  <div>
                    <p className="text-sm font-semibold text-ink-soft">Read this, then confirm</p>
                    <h2 className="font-display text-[26px] leading-tight font-semibold text-ink">{readingTitle(currentId)}</h2>
                  </div>
                </div>
                {currentId === APP_TOUR ? (
                  <div className="space-y-3">
                    <p className="text-[17px] text-ink">A two-minute tour: tap your name, do the next job, red means now, press How? when you&apos;re not sure, use the big buttons, and what to do when the inspector comes.</p>
                    <Link href="/welcome" className="inline-flex h-12 items-center gap-2 rounded-2xl bg-brand-soft px-4 font-semibold text-brand-deep"><Icon name="arrow" size={20} /> Open the tour</Link>
                  </div>
                ) : method && (
                  <>
                    <p className="text-[17px] text-ink">{method.oneLine}</p>
                    <ol className="space-y-2">
                      {method.steps.map((step, i) => (
                        <li key={i} className="flex gap-3 rounded-2xl bg-paper px-4 py-3">
                          <span className="h-8 w-8 shrink-0 rounded-full bg-brand text-white grid place-items-center text-sm font-bold">{i + 1}</span>
                          <span className="text-[17px] leading-snug text-ink pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                    {ourWay.get(method.id)?.our_way && (
                      <div className="rounded-2xl bg-brand-soft px-4 py-3">
                        <p className="font-bold text-brand-deep">How we do it here</p>
                        <p className="text-ink whitespace-pre-line">{ourWay.get(method.id)!.our_way}</p>
                      </div>
                    )}
                    <div className="rounded-2xl bg-danger-soft px-4 py-3 space-y-1">
                      <p className="font-bold text-danger-deep">If it goes wrong</p>
                      {method.wrong.map((w, i) => <p key={i} className="text-ink">{w.problem} → {w.fix}</p>)}
                    </div>
                  </>
                )}
                {error && <p role="alert" className="text-danger">{error}</p>}
                <button type="button" disabled={saving} onClick={() => confirm()} className="w-full h-16 rounded-2xl bg-brand text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40">
                  <Icon name="check" strokeWidth={2.5} /> {saving ? "Saving…" : "I've read and understood this"}
                </button>
                <p className="text-sm text-ink-soft text-center">Not sure about something? Ask the manager before you tick.</p>
              </section>
            )}

            <section>
              <h2 className="section-title mb-2.5">Everything to read</h2>
              <div className="rounded-2xl bg-surface border border-line divide-y divide-line overflow-hidden">
                {REQUIRED_READING.map((id) => {
                  const at = progress?.read.get(id);
                  return (
                    <button key={id} type="button" onClick={() => { setPicked(id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={`w-full flex items-center gap-3 px-4 py-3 text-left ${id === currentId ? "bg-brand-soft" : ""}`}>
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${at ? "bg-brand text-white" : "border-2 border-line text-ink-faint"}`}>{at ? <Icon name="check" size={16} strokeWidth={3} /> : null}</span>
                      <span className="flex-1 font-semibold text-ink">{readingTitle(id)}</span>
                      <span className="text-xs text-ink-soft">{at ? formatDate(at) : "To read"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
