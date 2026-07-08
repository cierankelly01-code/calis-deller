// After queueing an entry offline, splice it straight into the localStorage
// cache that the dashboard's cache-first queries read. Otherwise a staff
// member saves a reading, returns to the dashboard, and still sees "check
// due" until the outbox syncs and a refetch succeeds — which on flaky kitchen
// wifi can be minutes away. Server truth overwrites this on the next
// successful fetch.
export function appendToTodayCache(cacheKey: string, row: Record<string, unknown>): void {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    const list: unknown[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return;
    window.localStorage.setItem(cacheKey, JSON.stringify([row, ...list]));
  } catch {
    // Cache update is best-effort; the queued entry itself is safe in IndexedDB.
  }
}
