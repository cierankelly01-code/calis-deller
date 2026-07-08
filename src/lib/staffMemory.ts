"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { ActiveStaff } from "@/lib/data/queries";

// Remembers who last picked their name so the second, third, tenth check of
// a shift doesn't start with the same "who are you?" question. Stored
// per-device — on a shared iPad the pill shows the last user, one tap away
// from changing.

const KEY = "cd-last-staff";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): string | null {
  return window.localStorage.getItem(KEY);
}

export function useRememberedStaff(staff: ActiveStaff[]): {
  staffId: string | null;
  setStaffId: (id: string) => void;
} {
  // useSyncExternalStore keeps SSR hydration clean (server renders null,
  // client repaints with the stored value straight after).
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const [session, setSession] = useState<string | null>(null);

  const setStaffId = useCallback((id: string) => {
    window.localStorage.setItem(KEY, id);
    listeners.forEach((l) => l());
    setSession(id);
  }, []);

  const candidate = session ?? stored;
  // A remembered id only counts if that person is still on the active list.
  const staffId = candidate && staff.some((s) => s.id === candidate) ? candidate : null;

  return { staffId, setStaffId };
}
