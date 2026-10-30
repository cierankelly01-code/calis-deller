"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { HowLink } from "@/components/ui/HowLink";
import { useUser } from "@/components/auth/AuthBoundary";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useLiveQuery } from "@/lib/data/useLiveQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchHealthLogs, type HealthLog } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { formatDate } from "@/lib/methods/records";

// Fit for work. Everyone sees the rule; only a manager records who was sent
// home and when they were cleared (48 hours free of diarrhoea and vomiting).
// Health data is special-category personal data: the record is the minimum
// an inspector needs, deleted from the iPad once it syncs, never the medical details.

export default function HealthPage() {
  const user = useUser();
  const { site } = useSite();
  const isManager = user?.role === "manager";
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: logs, error: loadError } = useLiveQuery(`health:${site.id}`, () => fetchHealthLogs(site.id), isManager);
  const { staffId: managerId, setStaffId: setManagerId } = useRememberedStaff(staff ?? []);
  const [local, setLocal] = useState<HealthLog[]>([]);
  const [form, setForm] = useState<{ event: "sent_home" | "cleared"; subject: string | null; clear48: boolean; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = useMemo(() => [...local, ...(logs ?? [])].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)), [local, logs]);
  const name = (id: string) => (staff ?? []).find((s) => s.id === id)?.name ?? "Former staff";
  // Off now = their newest entry is "sent home".
  const offNow = useMemo(() => {
    const latest = new Map<string, HealthLog>();
    for (const l of all) if (!latest.has(l.subject_id)) latest.set(l.subject_id, l);
    return [...latest.values()].filter((l) => l.event === "sent_home");
  }, [all]);

  async function save() {
    if (!form || !form.subject || !managerId) return;
    setSaving(true);
    setError(null);
    try {
      const row = { staff_id: managerId, subject_id: form.subject, event: form.event, symptom_free_48h: form.event === "cleared" && form.clear48, note: form.note.trim() || null, recorded_at: new Date().toISOString() };
      const id = await queueEntry("health_logs", row);
      setLocal((l) => [{ id, ...row }, ...l]);
      void syncOutbox().catch(() => {});
      setForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Feeling ill?" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        <section className="rounded-2xl bg-danger-soft border-2 border-danger/30 px-5 py-4 space-y-2">
          <p className="text-xl font-bold text-danger-deep">Sick or diarrhoea? Don&apos;t touch food.</p>
          <ol className="list-decimal pl-5 space-y-1 text-[17px] text-ink">
            <li>Tell the manager straight away.</li>
            <li>Go home.</li>
            <li>Come back only 48 hours after you were last sick or had diarrhoea.</li>
          </ol>
          <HowLink method="fit-for-work" label="More: fit for work" />
        </section>

        {!isManager && <p className="text-ink-soft">The manager records who was sent home and when they came back.</p>}

        {isManager && (
          <>
            {loadError && <p role="alert" className="text-danger">Couldn&apos;t load the record. It needs the internet: itIt needs the internet (it&apos;s never stored on the iPad).apos;s kept on the server, not on the iPad.</p>}
            <section>
              <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Off sick now</h2>
              {offNow.length === 0 ? <p className="text-ink-soft">Nobody.</p> : (
                <div className="space-y-2">
                  {offNow.map((l) => (
                    <div key={l.id} className="flex items-center justify-between rounded-2xl bg-surface border border-line px-4 py-3">
                      <span><b>{name(l.subject_id)}</b> · sent home {formatDate(l.recorded_at)}</span>
                      <button type="button" onClick={() => setForm({ event: "cleared", subject: l.subject_id, clear48: false, note: "" })} className="h-10 rounded-xl bg-brand px-3 text-white font-semibold">Back to work</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {!form && <button type="button" onClick={() => setForm({ event: "sent_home", subject: null, clear48: false, note: "" })} className="w-full h-14 rounded-2xl border-2 border-danger/40 text-danger font-bold">Send someone home</button>}
            {form && (
              <section className="rounded-2xl bg-surface border border-line p-4 space-y-4">
                <p className="font-bold text-lg">{form.event === "sent_home" ? "Send someone home" : `${name(form.subject ?? "")} back to work`}</p>
                {form.event === "sent_home" && (
                  <>
                    <p className="text-sm font-semibold">Who?</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {(staff ?? []).map((s) => (
                        <button key={s.id} type="button" onClick={() => setForm({ ...form, subject: s.id })} className={`h-14 rounded-xl font-semibold ${form.subject === s.id ? "bg-danger text-white" : "bg-paper border border-line"}`}>{s.name}</button>
                      ))}
                    </div>
                  </>
                )}
                {form.event === "cleared" && (
                  <label className="flex items-start gap-3 text-[17px]">
                    <input type="checkbox" checked={form.clear48} onChange={(e) => setForm({ ...form, clear48: e.target.checked })} className="mt-1 h-6 w-6" />
                    It&apos;s been at least 48 hours since they were last sick or had diarrhoea.
                  </label>
                )}
                <label className="block text-sm">Note (optional, no medical details)<input value={form.note} maxLength={2000} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1 w-full h-11 rounded-xl border border-line bg-paper px-3" /></label>
                <p className="text-sm font-semibold">Manager recording</p>
                <StaffTilePicker staff={staff ?? []} selectedId={managerId} onSelect={setManagerId} />
                {error && <p role="alert" className="text-danger">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" disabled={saving || !form.subject || !managerId || (form.event === "cleared" && !form.clear48)} onClick={save} className="flex-1 h-12 rounded-xl bg-brand text-white font-bold disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
                  <button type="button" onClick={() => setForm(null)} className="h-12 rounded-xl border border-line px-4">Cancel</button>
                </div>
              </section>
            )}
            {all.length > 0 && (
              <section>
                <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Last 12 months</h2>
                <div className="space-y-1.5 text-sm">
                  {all.map((l) => (
                    <p key={l.id} className="rounded-xl bg-surface border border-line px-4 py-2.5">{formatDate(l.recorded_at)} · <b>{name(l.subject_id)}</b> · {l.event === "sent_home" ? "sent home" : "back to work (48 hours clear)"} · by {name(l.staff_id)}{l.note && ` · ${l.note}`}</p>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
