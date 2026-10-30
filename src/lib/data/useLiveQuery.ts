"use client";

import { useEffect, useState } from "react";

// Like useCachedQuery, but never written to localStorage: for personal data
// (training certificates, sickness) that must not sit on a shared iPad after
// the manager walks away. Needs the internet to show anything.
export function useLiveQuery<T>(key: string, fetcher: () => Promise<T>, enabled = true) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetcher()
      .then((data) => { if (!cancelled) setResult({ key, data, error: null }); })
      .catch((err: unknown) => { if (!cancelled) setResult({ key, data: null, error: err instanceof Error ? err.message : "Failed to load" }); });
    return () => { cancelled = true; };
    // fetcher is stable per key, as with useCachedQuery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, loading: enabled && !current, error: current?.error ?? null };
}
