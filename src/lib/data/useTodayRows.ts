"use client";

import { useEffect, useMemo, useState } from "react";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { localDayKey, onlyOnDay } from "@/lib/data/today";

// useCachedQuery for a "today's logs" list. Same cache-first paint, but rows
// from any other day are dropped, and the day rolls over while the page stays
// open (checked each minute and whenever the app comes back to the front).
export function useTodayRows<T extends { recorded_at: string }>(cacheKey: string, fetcher: () => Promise<T[]>) {
  const result = useCachedQuery<T[]>(cacheKey, fetcher);
  const [day, setDay] = useState(() => localDayKey(new Date()));

  useEffect(() => {
    const check = () => setDay(localDayKey(new Date()));
    const id = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const data = useMemo(() => (result.data ? onlyOnDay(result.data, day) : result.data), [result.data, day]);
  // `day` is returned so a page can key its own "done this visit" state by
  // day too; otherwise ticks held in memory outlive midnight.
  return { ...result, data, day };
}
