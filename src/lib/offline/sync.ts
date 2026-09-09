import { supabase } from "@/lib/supabase/client";
import { getUnsyncedEntries, markSynced, type OutboxEntry } from "@/lib/offline/outbox";
import { getBrowserUser } from '@/lib/security/browser-session';

// Safari on iOS has no Background Sync API, so this in-app worker is the
// real sync mechanism (not the service worker) — see public/sw.js. It's
// driven by: an explicit call right after a write, the 'online' event,
// tab visibility changing back to visible, and a periodic interval while
// the app is open. A kiosk iPad left open through a shift covers the
// realistic usage pattern without needing true background sync.

const SYNC_INTERVAL_MS = 30_000;

let syncing = false;

async function pushEntry(entry: OutboxEntry): Promise<boolean> {
  // Plain insert, never upsert: log tables are append-only (RLS denies
  // UPDATE), so an upsert that hits the client_id conflict would try an
  // UPDATE, get rejected, and leave the entry stuck unsynced forever.
  // A duplicate-key error (23505) means the row already made it to the
  // server on an earlier attempt — that IS success.
  const { error } = await supabase
    .from(entry.table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(entry.payload as any);

  if (error) {
    return false;
  }
  return true;
}

export async function syncOutbox(): Promise<{ synced: number; remaining: number }> {
  const user = getBrowserUser();
  if (!user || syncing || (typeof navigator !== "undefined" && !navigator.onLine)) {
    const remaining = (await getUnsyncedEntries()).length;
    return { synced: 0, remaining };
  }

  syncing = true;
  let synced = 0;
  try {
    const entries = await getUnsyncedEntries();
    for (const entry of entries) {
      if (entry.ownerId !== user.id || getBrowserUser()?.id !== user.id) continue;
      const ok = await pushEntry(entry);
      if (ok) {
        await markSynced(entry.clientId);
        synced += 1;
      }
    }
  } finally {
    syncing = false;
  }

  const remaining = (await getUnsyncedEntries()).length;
  return { synced, remaining };
}

export function startSyncLoop(onChange?: (remaining: number) => void): () => void {
  const runAndReport = () => {
    syncOutbox().then(({ remaining }) => onChange?.(remaining)).catch(() => {
      // A network/storage failure must retain queued entries for the next try.
      onChange?.(-1);
    });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") runAndReport();
  };

  runAndReport();
  const interval = setInterval(runAndReport, SYNC_INTERVAL_MS);
  window.addEventListener("online", runAndReport);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    clearInterval(interval);
    window.removeEventListener("online", runAndReport);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
