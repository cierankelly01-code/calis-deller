import type { MethodRecord } from "@/lib/data/queries";
import { SAFE_METHODS } from "@/lib/methods/content";

// The current sign-off per safe method for one shop: the newest record wins,
// older ones stay as history (records are append-only).
export function currentSignOffs(records: MethodRecord[]): Map<string, MethodRecord> {
  const current = new Map<string, MethodRecord>();
  for (const record of [...records].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))) {
    if (!current.has(record.method_id)) current.set(record.method_id, record);
  }
  return current;
}

export function signOffProgress(records: MethodRecord[]): { signed: number; total: number } {
  const current = currentSignOffs(records);
  return { signed: SAFE_METHODS.filter((m) => current.has(m.id)).length, total: SAFE_METHODS.length };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
