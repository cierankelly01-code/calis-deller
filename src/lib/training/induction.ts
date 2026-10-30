import type { InductionLog } from "@/lib/data/queries";
import { findMethod } from "@/lib/methods/content";

// The safe methods every member of staff reads and confirms before they work
// on their own: the ones that touch every shift. The rest of the book is
// there for the jobs that need it. "app-tour" is the welcome tour itself.
export const APP_TOUR = "app-tour";
export const REQUIRED_READING: string[] = [
  APP_TOUR,
  "hand-washing",
  "personal-hygiene",
  "fit-for-work",
  "washing-up",
  "two-stage-clean",
  "cloths",
  "clear-as-you-go",
  "separating-foods",
  "allergens",
  "customers-allergies",
  "chilled-storage",
  "chilling-down",
  "sandwiches-out",
  "cooking-safely",
  "hot-holding",
  "pest-control",
  "opening-closing",
];

export function readingTitle(id: string): string {
  return id === APP_TOUR ? "How this app works" : findMethod(id)?.title ?? id;
}

export type InductionProgress = {
  staffId: string;
  read: Map<string, string>; // method id → when it was confirmed (latest)
  done: number;
  total: number;
  complete: boolean;
  nextId: string | null;
  completedAt: string | null; // when the last required item was confirmed
};

export function inductionProgress(logs: InductionLog[], staffId: string): InductionProgress {
  const read = new Map<string, string>();
  for (const log of logs) {
    if (log.staff_id !== staffId || !REQUIRED_READING.includes(log.method_id)) continue;
    const prev = read.get(log.method_id);
    if (!prev || log.recorded_at > prev) read.set(log.method_id, log.recorded_at);
  }
  const done = REQUIRED_READING.filter((id) => read.has(id)).length;
  const complete = done === REQUIRED_READING.length;
  return {
    staffId,
    read,
    done,
    total: REQUIRED_READING.length,
    complete,
    nextId: REQUIRED_READING.find((id) => !read.has(id)) ?? null,
    completedAt: complete ? [...read.values()].sort().at(-1)! : null,
  };
}
