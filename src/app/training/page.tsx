"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { HowLink } from "@/components/ui/HowLink";
import { useUser } from "@/components/auth/AuthBoundary";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useLiveQuery } from "@/lib/data/useLiveQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchTrainingRecords, type TrainingRecord } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { SAFE_METHODS, findMethod } from "@/lib/methods/content";
import { formatDate } from "@/lib/methods/records";
import { trainingByPerson, type CertStatus } from "@/lib/training/status";
import { certificateUrl, uploadCertificate } from "@/lib/training/upload";
import type { TrainingKind } from "@/types/database";

// The SFBB staff training record, plus each person's food hygiene
// certificate. Managers only: certificates are personal data, and the API
// and database refuse staff accounts too. Records are append-only; a
// renewal is a new record and the longest-lasting certificate counts.

const KIND_LABEL: Record<TrainingKind, string> = {
  certificate: "Food hygiene certificate",
  method: "Trained on a safe method",
  induction: "First-day induction",
  refresher: "Refresher on a safe method",
};
const STATUS: Record<CertStatus, { label: string; cls: string }> = {
  ok: { label: "Certificate in date", cls: "bg-brand-soft text-brand-deep" },
  expiring: { label: "Certificate expires soon", cls: "bg-gold text-ink" },
  expired: { label: "Certificate expired", cls: "bg-danger text-white" },
  none: { label: "No certificate yet", cls: "bg-gold-soft text-gold-deep" },
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TrainingPage() {
  const user = useUser();
  const { site } = useSite();
  const isManager = user?.role === "manager";
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: records, error: loadError } = useLiveQuery(`training:${site.id}`, () => fetchTrainingRecords(site.id), isManager);
  const { staffId: recorderId, setStaffId: setRecorderId } = useRememberedStaff(staff ?? []);
  const [local, setLocal] = useState<TrainingRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null); // trainee being added for
  const [kind, setKind] = useState<TrainingKind>("certificate");
  const [topic, setTopic] = useState("Level 2 Food Hygiene");
  const [trainedOn, setTrainedOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => [...local, ...(records ?? [])], [local, records]);
  const people = useMemo(() => trainingByPerson(all, (staff ?? []).map((s) => s.id)), [all, staff]);

  if (!isManager) {
    return (
      <div className="flex flex-col flex-1">
        <PageHeader title="Training" />
        <p className="p-6 text-ink-soft">Training records and certificates are private. Ask the manager to sign in to see them.</p>
      </div>
    );
  }

  function startAdding(traineeId: string, nextKind: TrainingKind) {
    setOpen(traineeId);
    setKind(nextKind);
    setTopic(nextKind === "certificate" ? "Level 2 Food Hygiene" : nextKind === "induction" ? "First-day induction" : SAFE_METHODS[0].id);
    setTrainedOn(today());
    setExpiresOn("");
    setFile(null);
    setNote("");
    setError(null);
  }

  async function save(traineeId: string) {
    if (!recorderId || !topic.trim() || !trainedOn) return;
    setSaving(true);
    setError(null);
    try {
      const path = kind === "certificate" && file ? await uploadCertificate(site.id, file) : null;
      const row = {
        staff_id: recorderId,
        trainee_id: traineeId,
        kind,
        topic: topic.trim(),
        trained_on: trainedOn,
        expires_on: kind === "certificate" && expiresOn ? expiresOn : null,
        certificate_path: path,
        note: note.trim() || null,
        recorded_at: new Date().toISOString(),
      };
      const clientId = await queueEntry("training_records", row);
      setLocal((l) => [{ id: clientId, client_id: clientId, ...row }, ...l]);
      void syncOutbox().catch(() => {});
      setOpen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Training" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        <div className="rounded-2xl bg-brand-soft border border-brand/20 px-5 py-4">
          <p className="font-bold text-brand-deep">Staff training: {site.short_name}</p>
          <p className="mt-1 text-sm text-ink-soft">Everyone who handles food: their certificate, and which safe methods they&apos;ve been shown. Only managers can see this page.</p>
          <div className="mt-3"><HowLink method="training" label="What training do staff need?" /></div>
        </div>
        {loadError && <p role="alert" className="text-danger">Couldn&apos;t load training records. They need the internet: theyThey need the internet (they&apos;re never stored on the iPad).apos;re kept on the server, not on the iPad.</p>}

        <section>
          <h2 className="section-title mb-2.5">Manager recording</h2>
          <StaffTilePicker staff={staff ?? []} selectedId={recorderId} onSelect={setRecorderId} />
        </section>

        {people.map((person) => {
          const name = (staff ?? []).find((s) => s.id === person.staffId)?.name ?? "";
          const status = STATUS[person.certStatus];
          return (
            <article key={person.staffId} className="rounded-2xl bg-surface border border-line px-4 py-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-lg font-bold text-ink">{name}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.cls}`}>{status.label}</span>
              </div>
              {person.certificate && (
                <p className="text-sm text-ink">
                  {person.certificate.topic} · {formatDate(person.certificate.trained_on)}
                  {person.certificate.expires_on && ` · expires ${formatDate(person.certificate.expires_on)}`}
                  {person.certificate.certificate_path && <> · <a href={certificateUrl(person.certificate.certificate_path)} target="_blank" rel="noopener" className="font-semibold text-brand underline">View certificate</a></>}
                </p>
              )}
              <p className="text-sm text-ink-soft">
                {person.inducted ? "Induction done" : "No induction recorded"} · trained on {person.methods.size} of {SAFE_METHODS.length} methods
                {person.methods.size > 0 && `: ${[...person.methods].map((m) => findMethod(m)?.title ?? m).join(", ")}`}
              </p>
              {open !== person.staffId ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => startAdding(person.staffId, "certificate")} className="h-11 rounded-xl bg-brand px-4 text-white font-semibold">+ Certificate</button>
                  <button type="button" onClick={() => startAdding(person.staffId, "method")} className="h-11 rounded-xl border border-line px-4 font-semibold">+ Trained on a method</button>
                  {!person.inducted && <button type="button" onClick={() => startAdding(person.staffId, "induction")} className="h-11 rounded-xl border border-line px-4 font-semibold">+ Induction</button>}
                </div>
              ) : (
                <div className="space-y-3 rounded-xl bg-paper p-3">
                  <p className="font-semibold">{KIND_LABEL[kind]}</p>
                  {kind === "certificate" && (
                    <>
                      <label className="block text-sm">Certificate<input value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-surface px-3" /></label>
                      <label className="block text-sm">Photo or PDF of the certificate
                        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
                      </label>
                      <p className="text-xs text-ink-soft">Tell {name} you&apos;re keeping a copy. Needs the internet to upload.</p>
                    </>
                  )}
                  {(kind === "method" || kind === "refresher") && (
                    <label className="block text-sm">Which method?
                      <select value={topic} onChange={(e) => setTopic(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-surface px-3">
                        {SAFE_METHODS.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-sm">{kind === "certificate" ? "Date passed" : "Date trained"}<input type="date" value={trainedOn} max={today()} onChange={(e) => setTrainedOn(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-surface px-2" /></label>
                    {kind === "certificate" && <label className="block text-sm">Expires (if it says)<input type="date" value={expiresOn} min={trainedOn} onChange={(e) => setExpiresOn(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-surface px-2" /></label>}
                  </div>
                  <label className="block text-sm">Note (optional)<input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-surface px-3" /></label>
                  {!recorderId && <p className="text-sm text-gold-deep">Pick who&apos;s recording at the top first.</p>}
                  {error && <p role="alert" className="text-danger">{error}</p>}
                  <div className="flex gap-2">
                    <button type="button" disabled={saving || !recorderId || !topic.trim()} onClick={() => save(person.staffId)} className="flex-1 h-12 rounded-xl bg-brand text-white font-bold disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
                    <button type="button" onClick={() => setOpen(null)} className="h-12 rounded-xl border border-line px-4">Cancel</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
