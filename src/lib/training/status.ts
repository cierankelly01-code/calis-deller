import type { TrainingRecord } from "@/lib/data/queries";

// Per person: their newest certificate (and whether it's in date), which
// safe methods they've been trained on, and whether they had an induction.
// Records are append-only, so "newest wins" per certificate name.

export type CertStatus = "ok" | "expiring" | "expired" | "none";

export type PersonTraining = {
  staffId: string;
  certificate: TrainingRecord | null;
  certStatus: CertStatus;
  methods: Set<string>;
  inducted: boolean;
  records: TrainingRecord[]; // newest first
};

const DAY = 24 * 60 * 60 * 1000;

export function certStatus(record: TrainingRecord | null, today: Date = new Date()): CertStatus {
  if (!record) return "none";
  if (!record.expires_on) return "ok";
  const expires = new Date(`${record.expires_on}T23:59:59`).getTime();
  if (expires < today.getTime()) return "expired";
  return expires - today.getTime() <= 30 * DAY ? "expiring" : "ok";
}

export function trainingByPerson(records: TrainingRecord[], staffIds: string[], today: Date = new Date()): PersonTraining[] {
  return staffIds.map((staffId) => {
    const mine = records.filter((r) => r.trainee_id === staffId).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    // The certificate that lasts longest is the one that counts.
    const certs = mine.filter((r) => r.kind === "certificate");
    const certificate = certs.sort((a, b) => (b.expires_on ?? "9999").localeCompare(a.expires_on ?? "9999"))[0] ?? null;
    return {
      staffId,
      certificate,
      certStatus: certStatus(certificate, today),
      methods: new Set(mine.filter((r) => r.kind === "method" || r.kind === "refresher").map((r) => r.topic)),
      inducted: mine.some((r) => r.kind === "induction"),
      records: mine,
    };
  });
}

export function certificatesNeedingAction(people: PersonTraining[]): number {
  return people.filter((p) => p.certStatus !== "ok").length;
}
