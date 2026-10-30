// "What do I do now?" — the staff home screen as one list. Every job says
// what to do, where to tap, and which safe method shows how. Red means do it
// now (something's over time or out of range), amber means it's due, green
// means it's done. Pure, so the rules are tested without a browser.

export type JobTone = "red" | "amber" | "green";

export type Job = {
  key: string;
  title: string;
  detail: string;
  href: string;
  method: string; // safe method id for "How do I do this?"
  tone: JobTone;
};

export type JobsInput = {
  now: Date;
  slot: "am" | "pm";
  fridges: { total: number; due: number; outOfRange: number };
  cleaning: { session: "open" | "close"; total: number; done: number };
  cooling: { onClock: number; soon: number; overdue: number; soonestLabel: string | null };
  sandwiches: { overdue: number; soon: boolean; label: string | null };
  counter: { overdue: number; dueToday: number };
  siteChecks: { kind: "pest" | "hand_wash" | "maintenance"; ok: boolean; recorded_at: string }[];
  probeChecks: { pass: boolean; recorded_at: string }[];
  // Manager only (undefined for staff accounts).
  lastReviewAt?: string | null;
  certificatesExpiring?: number;
};

const DAY = 24 * 60 * 60 * 1000;

function sameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function within(iso: string, now: Date, days: number): boolean {
  return now.getTime() - Date.parse(iso) < days * DAY;
}

const ORDER: Record<JobTone, number> = { red: 0, amber: 1, green: 2 };

export function buildJobs(input: JobsInput): Job[] {
  const { now } = input;
  const jobs: Job[] = [];
  const part = input.slot === "am" ? "morning" : "afternoon";

  if (input.fridges.total > 0) {
    const { due, outOfRange, total } = input.fridges;
    jobs.push({
      key: "fridge",
      title: `Fridge temperatures (${part})`,
      detail: outOfRange > 0 ? `${outOfRange} too warm or too cold. Act now.` : due > 0 ? `${due} of ${total} to check` : "All checked",
      href: "/log/fridge",
      method: "chilled-storage",
      tone: outOfRange > 0 ? "red" : due > 0 ? "amber" : "green",
    });
  }

  if (input.cleaning.total > 0) {
    const { session, total, done } = input.cleaning;
    jobs.push({
      key: "cleaning",
      title: session === "open" ? "Opening clean" : "Closing clean",
      detail: done >= total ? "All done" : `${done} of ${total} done`,
      href: "/log/cleaning",
      method: "opening-closing",
      tone: done >= total ? "green" : "amber",
    });
  }

  const handWash = input.siteChecks.find((c) => c.kind === "hand_wash" && sameLocalDay(c.recorded_at, now));
  jobs.push({
    key: "hand_wash",
    title: "Hand sink check",
    detail: handWash ? (handWash.ok ? "Soap, hot water, towels: all OK" : "Problem reported today") : "Soap, hot water and paper towels?",
    href: "/checks?kind=hand_wash",
    method: "hand-washing",
    tone: handWash ? (handWash.ok ? "green" : "red") : "amber",
  });

  const pest = input.siteChecks.find((c) => c.kind === "pest" && within(c.recorded_at, now, 7));
  jobs.push({
    key: "pest",
    title: "Pest check (weekly)",
    detail: pest ? (pest.ok ? "No signs this week" : "Signs reported this week") : "Not done this week",
    href: "/checks?kind=pest",
    method: "pest-control",
    tone: pest ? (pest.ok ? "green" : "red") : "amber",
  });

  const probe = input.probeChecks.find((c) => within(c.recorded_at, now, 7));
  jobs.push({
    key: "probe",
    title: "Probe check (weekly)",
    detail: probe ? (probe.pass ? "Probe reads true this week" : "Probe failed this week") : "Not done this week",
    href: "/log/probe",
    method: "prove-it",
    tone: probe ? (probe.pass ? "green" : "red") : "amber",
  });

  if (input.cooling.onClock > 0) {
    const { overdue, soon, onClock, soonestLabel } = input.cooling;
    jobs.push({
      key: "cooling",
      title: "Cooling clock",
      detail: overdue > 0 ? `${overdue} over 2 hours. Chill or bin now.` : `${onClock} cooling · ${soonestLabel ?? ""}`.trim(),
      href: "/cooling",
      method: "chilling-down",
      tone: overdue > 0 ? "red" : soon > 0 ? "amber" : "green",
    });
  }

  if (input.sandwiches.label) {
    jobs.push({
      key: "sandwiches",
      title: "Sandwiches",
      detail: input.sandwiches.label,
      href: "/sandwiches",
      method: "sandwiches-out",
      tone: input.sandwiches.overdue > 0 ? "red" : input.sandwiches.soon ? "amber" : "green",
    });
  }

  if (input.counter.overdue > 0 || input.counter.dueToday > 0) {
    jobs.push({
      key: "counter",
      title: "Counter dates",
      detail: input.counter.overdue > 0 ? `${input.counter.overdue} past date. Bin now.` : `${input.counter.dueToday} to bin tonight`,
      href: "/counter",
      method: "stock-control",
      tone: input.counter.overdue > 0 ? "red" : "amber",
    });
  }

  if (input.lastReviewAt !== undefined) {
    const done = input.lastReviewAt != null && within(input.lastReviewAt, now, 28);
    jobs.push({
      key: "review",
      title: "4-weekly review (manager)",
      detail: done ? "Done in the last 4 weeks" : input.lastReviewAt ? "Due: last one over 4 weeks ago" : "Not done yet",
      href: "/review",
      method: "four-weekly-review",
      tone: done ? "green" : "amber",
    });
  }

  if (input.certificatesExpiring) {
    jobs.push({
      key: "training",
      title: "Certificates (manager)",
      detail: `${input.certificatesExpiring} staff need a certificate added or renewed`,
      href: "/training",
      method: "training",
      tone: "amber",
    });
  }

  return jobs.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}

export function jobsLeft(jobs: Job[]): number {
  return jobs.filter((j) => j.tone !== "green").length;
}
