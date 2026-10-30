"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { useUser } from "@/components/auth/AuthBoundary";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchAllStaff, fetchMethodRecords, type MethodRecord } from "@/lib/data/queries";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { findMethod } from "@/lib/methods/content";
import { currentSignOffs, formatDate } from "@/lib/methods/records";
import { useRememberedStaff } from "@/lib/staffMemory";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { methodIcon } from "@/lib/methods/icons";
import { Icon, IconTile } from "@/components/ui/Icon";

// One safe method, written for the person doing the job: numbered steps,
// why it matters, what to do if it goes wrong, and how this shop does it.
// A manager signs it off for the shop (the SFBB "safe method completion
// record"); every sign-off is kept.

export default function MethodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const method = findMethod(id);
  const user = useUser();
  const { site } = useSite();
  const { data: records } = useCachedQuery(`cd-method-records:${site.id}`, () => fetchMethodRecords(site.id));
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: allStaff } = useCachedQuery(`cd-all-staff:${site.id}`, () => fetchAllStaff(site.id));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [local, setLocal] = useState<MethodRecord[]>([]);
  const current = useMemo(() => currentSignOffs([...local, ...(records ?? [])]).get(id) ?? null, [local, records, id]);
  const [editing, setEditing] = useState(false);
  // Tick each step as you do it: on screen only, nothing is saved.
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [ourWay, setOurWay] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const nameOf = (sid: string) => (allStaff ?? []).find((s) => s.id === sid)?.name ?? "a manager";

  if (!method) {
    return (
      <div className="flex flex-col flex-1">
        <PageHeader title="Not found" backHref="/methods" />
        <p className="p-6 text-ink-soft">That method doesn&apos;t exist. <Link href="/methods" className="underline text-brand">See all methods</Link></p>
      </div>
    );
  }

  async function signOff() {
    if (!staffId) return;
    setState("saving");
    setError("");
    try {
      const row = { staff_id: staffId, method_id: id, our_way: ourWay.trim() || null, recorded_at: new Date().toISOString() };
      const clientId = await queueEntry("method_records", row);
      const saved: MethodRecord = { id: clientId, ...row };
      setLocal((l) => [saved, ...l]);
      appendToTodayCache(`cd-method-records:${site.id}`, saved);
      void syncOutbox().catch(() => {});
      setState("saved");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title={method.title} backHref="/methods" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        <div className="flex items-start gap-4">
          <IconTile name={methodIcon(method.id, method.group)} size="lg" />
          <p className="text-lg text-ink leading-snug pt-1.5">{method.oneLine}</p>
        </div>

        <section>
          <div className="flex items-end justify-between mb-2.5"><h2 className="section-title">Do this, in order</h2><p className="text-sm text-ink-soft">Tap each step when done</p></div>
          <ol className="space-y-2">
            {method.steps.map((step, i) => (
              <li key={i}>
                <button type="button" aria-pressed={ticked.has(i)} onClick={() => setTicked((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n; })} className={`w-full flex gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors ${ticked.has(i) ? "bg-brand-soft border-brand/30" : "bg-surface border-line"}`}>
                  <span className={`h-9 w-9 shrink-0 rounded-full grid place-items-center font-bold ${ticked.has(i) ? "bg-brand text-white" : "bg-paper text-brand-deep border-2 border-brand/40"}`}>{ticked.has(i) ? <Icon name="check" size={18} strokeWidth={3} /> : i + 1}</span>
                  <span className={`text-[17px] leading-snug pt-1 ${ticked.has(i) ? "text-ink-soft" : "text-ink"}`}>{step}</span>
                </button>
              </li>
            ))}
          </ol>
          {ticked.size === method.steps.length && <p className="mt-3 rounded-2xl bg-brand text-white px-4 py-3 font-bold flex items-center gap-2"><Icon name="check" strokeWidth={3} /> All steps done. Well done.</p>}
          {method.needsProduct && (
            <p className="mt-3 rounded-2xl bg-gold-soft border border-gold/50 px-4 py-3 text-sm text-ink">
              <b>Which product and how long to leave it on:</b> {current?.our_way ? "see “How we do it here” below." : "to be added by the manager (read the label: it must meet BS EN 1276 or BS EN 13697)."}
            </p>
          )}
        </section>

        {(current?.our_way || user?.role === "manager") && (
          <section className="rounded-2xl border-2 border-brand/30 bg-brand-soft px-5 py-4">
            <h2 className="font-bold text-brand-deep">How we do it here: {site.short_name}</h2>
            {current?.our_way ? <p className="mt-1.5 text-[17px] text-ink whitespace-pre-line">{current.our_way}</p> : <p className="mt-1.5 text-sm text-ink-soft">{method.shopNotePrompt}</p>}
          </section>
        )}

        <section className="rounded-2xl bg-surface border border-line px-5 py-4">
          <h2 className="font-bold text-ink">Why it matters</h2>
          <p className="mt-1 text-ink-soft">{method.why}</p>
        </section>

        <section>
          <h2 className="section-title mb-2.5">If it goes wrong</h2>
          <div className="space-y-2">
            {method.wrong.map((w, i) => (
              <div key={i} className="rounded-2xl bg-danger-soft border border-danger/20 px-4 py-3">
                <p className="font-semibold text-danger-deep">{w.problem}</p>
                <p className="text-ink mt-0.5">→ {w.fix}</p>
              </div>
            ))}
          </div>
        </section>

        {method.appCheck && (
          <Link href={method.appCheck.href} className="flex items-center justify-between rounded-2xl bg-brand px-5 py-4 text-white font-bold active:scale-[0.99] transition-transform">
            <span className="flex items-center gap-2"><Icon name="check" size={20} /> Record it: {method.appCheck.label}</span> <Icon name="arrow" size={20} />
          </Link>
        )}

        <section className="rounded-2xl bg-surface border border-line px-5 py-4 space-y-3">
          <p className="text-sm text-ink-soft">
            {current ? <>Signed off for {site.short_name} by <b className="text-ink">{nameOf(current.staff_id)}</b> on {formatDate(current.recorded_at)}.</> : <>Not signed off for {site.short_name} yet.</>}
            {state === "saved" && " Saved ✓"}
          </p>
          {user?.role === "manager" && !editing && (
            <button type="button" onClick={() => { setOurWay(current?.our_way ?? ""); setEditing(true); setState("idle"); }} className="h-12 rounded-xl border border-brand/40 px-4 font-semibold text-brand">
              {current ? "Update and sign off again" : "Sign off for this shop"}
            </button>
          )}
          {editing && (
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-ink">
                How we do it here <span className="font-normal text-ink-soft">({method.shopNotePrompt})</span>
                <textarea maxLength={2000} value={ourWay} onChange={(e) => setOurWay(e.target.value)} className="mt-1 w-full rounded-2xl border border-line bg-paper p-3.5 text-base min-h-24 focus:outline-none focus:border-brand" />
              </label>
              <p className="text-sm font-semibold text-ink">Who&apos;s signing?</p>
              <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
              {error && <p role="alert" className="text-danger">{error}</p>}
              <div className="flex gap-2">
                <button type="button" disabled={!staffId || state === "saving"} onClick={signOff} className="flex-1 h-12 rounded-xl bg-brand text-white font-bold disabled:opacity-40">
                  {state === "saving" ? "Saving…" : "I confirm this is how we work"}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="h-12 rounded-xl border border-line px-4">Cancel</button>
              </div>
            </div>
          )}
        </section>
        <p className="text-xs text-ink-faint">Source: FSA Safer food, better business ({method.source}). Contains public sector information licensed under the Open Government Licence v3.0.</p>
      </div>
    </div>
  );
}
