import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { getBrowserUser } from '@/lib/security/browser-session';
import { validateWrite } from '@/lib/security/policy';

// Local-first write queue. Every log entry is written here immediately —
// the UI can confirm "Saved" regardless of connectivity — and a separate
// sync worker (see sync.ts) drains it to Supabase when possible. Table
// name + row payload are kept generic so every module (fridge, probe,
// delivery, ...) can reuse the same queue.

export type OutboxTable =
  | "fridge_temp_logs"
  | "cooking_logs"
  | "delivery_logs"
  | "cleaning_logs"
  | "probe_calibration_logs"
  | "counter_stock_logs"
  | "ambient_display_logs";

export type OutboxEntry = {
  clientId: string; // matches the row's client_id column; used for idempotent upsert
  table: OutboxTable;
  payload: Record<string, unknown>;
  queuedAt: string;
  synced: boolean;
  ownerId?: string; // absent only on legacy entries; a manager must claim them
};

interface OutboxDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxEntry;
  };
}

let dbPromise: Promise<IDBPDatabase<OutboxDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OutboxDB>("calis-deller-outbox", 1, {
      upgrade(db) {
        db.createObjectStore("outbox", { keyPath: "clientId" });
      },
    });
  }
  return dbPromise;
}

export async function queueEntry(
  table: OutboxTable,
  payload: Record<string, unknown>
): Promise<string> {
  const user = getBrowserUser();
  if (!user) throw new Error('Sign in before saving');
  const clientId = crypto.randomUUID();
  const validated = validateWrite(table,'POST',{...payload,client_id:clientId});

  const db = await getDb();
  await db.put("outbox", {
    clientId,
    table,
    payload: validated,
    ownerId: user.id,
    queuedAt: new Date().toISOString(),
    synced: false,
  });
  return clientId;
}

export async function getUnsyncedEntries(): Promise<OutboxEntry[]> {
  const db = await getDb();
  const all = await db.getAll("outbox");
  return all.filter((entry) => !entry.synced);
}

export async function markSynced(clientId: string): Promise<void> {
  const db = await getDb();
  const entry = await db.get("outbox", clientId);
  if (entry) {
    await db.put("outbox", { ...entry, synced: true });
  }
}

export async function getUnsyncedCount(): Promise<number> {
  const entries = await getUnsyncedEntries();
  return entries.length;
}

export async function claimLegacyEntries(ownerId:string) {
  const user=getBrowserUser();
  if(user?.role!=='manager' || user.id!==ownerId) throw new Error('Manager required');
  const db=await getDb();
  const tx=db.transaction('outbox','readwrite');
  for(const entry of await tx.store.getAll()) {
    if(!entry.synced && !entry.ownerId) await tx.store.put({...entry,ownerId});
  }
  await tx.done;
}
export async function removeSyncedEntries() {
  const db=await getDb();
  const tx=db.transaction('outbox','readwrite');
  for(const entry of await tx.store.getAll()) if(entry.synced) await tx.store.delete(entry.clientId);
  await tx.done;
}
