import type { InductionLog } from "@/lib/data/queries";
import { findMethod } from "@/lib/methods/content";
import { QUIZ_ID } from "@/lib/training/quiz";

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
  done: number; // reading confirmed
  total: number;
  readingDone: boolean;
  quizPassedAt: string | null; // the end quiz, passed with every answer right
  complete: boolean; // all reading AND the quiz
  nextId: string | null;
  completedAt: string | null; // when training finished (the quiz pass)
};

export function inductionProgress(logs: InductionLog[], staffId: string): InductionProgress {
  const read = new Map<string, string>();
  let quizPassedAt: string | null = null;
  for (const log of logs) {
    if (log.staff_id === staffId && log.method_id === QUIZ_ID && (!quizPassedAt || log.recorded_at > quizPassedAt)) quizPassedAt = log.recorded_at;
    if (log.staff_id !== staffId || !REQUIRED_READING.includes(log.method_id)) continue;
    const prev = read.get(log.method_id);
    if (!prev || log.recorded_at > prev) read.set(log.method_id, log.recorded_at);
  }
  const done = REQUIRED_READING.filter((id) => read.has(id)).length;
  const readingDone = done === REQUIRED_READING.length;
  const complete = readingDone && quizPassedAt !== null;
  return {
    staffId,
    read,
    done,
    total: REQUIRED_READING.length,
    readingDone,
    quizPassedAt,
    complete,
    nextId: REQUIRED_READING.find((id) => !read.has(id)) ?? null,
    completedAt: complete ? quizPassedAt : null,
  };
}
