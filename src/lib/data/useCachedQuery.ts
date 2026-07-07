"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// useSyncExternalStore requires getSnapshot to return a referentially
// stable value when the underlying data hasn't changed — JSON.parse-ing on
// every call would return a new object each time and trigger React's
// "getSnapshot should be cached" infinite-loop guard. Cache the parsed
// result per key, keyed off the raw string, so unchanged localStorage
// content always yields the same reference.
const parsedSnapshotCache = new Map<string, { raw: string | null; parsed: unknown }>();

function readCache<T>(cacheKey: string): T | null {
  const raw = window.localStorage.getItem(cacheKey);
  const cached = parsedSnapshotCache.get(cacheKey);
  if (cached && cached.raw === raw) {
    return cached.parsed as T | null;
  }

  let parsed: T | null = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as T;
    } catch {
      parsed = null;
    }
  }
  parsedSnapshotCache.set(cacheKey, { raw, parsed });
  return parsed;
}

function noopSubscribe() {
  return () => {};
}

// Instant paint from the last successful fetch (localStorage), refreshed in
// the background when online. Keeps config screens (staff/unit pickers)
// usable on a kiosk iPad that opens the app before wifi has reconnected.
//
// localStorage doesn't exist during SSR, so reading it can't happen in a
// plain useState initializer without a server/client hydration mismatch
// (the server renders "no cache", the client's first render would already
// see it). useSyncExternalStore is built for exactly this: it forces the
// first client render to match the server snapshot (null), then repaints
// with the real cached value immediately after hydration.
export function useCachedQuery<T>(cacheKey: string, fetcher: () => Promise<T>) {
  const cached = useSyncExternalStore(
    noopSubscribe,
    () => readCache<T>(cacheKey),
    () => null
  );

  const [freshData, setFreshData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hadCache = cached !== null;

    fetcher()
      .then((result) => {
        if (cancelled) return;
        setFreshData(result);
        setError(null);
        window.localStorage.setItem(cacheKey, JSON.stringify(result));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (!hadCache) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // fetcher is expected to be stable per cacheKey; re-running on identity
    // change would defeat the point of the cache-first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { data: freshData ?? cached, loading, error };
}
