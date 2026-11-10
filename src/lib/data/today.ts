// "Today" for the due-now lists is the device's local calendar day, the same
// day fetchToday*Logs asks the server for. The lists are painted from a
// localStorage cache first, and that cache can be yesterday's: the page was
// left open overnight, or the morning fetch failed on bad wifi. Every reader
// of a "today" list filters through here so an old row can never tick off
// today's check.

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function isOnLocalDay(iso: string, dayKey: string): boolean {
  const t = new Date(iso);
  return !Number.isNaN(t.getTime()) && localDayKey(t) === dayKey;
}

export function onlyOnDay<T extends { recorded_at: string }>(
  rows: readonly T[],
  dayKey: string = localDayKey(new Date())
): T[] {
  return rows.filter((row) => isOnLocalDay(row.recorded_at, dayKey));
}
