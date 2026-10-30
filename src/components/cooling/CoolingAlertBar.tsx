"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSite } from "@/lib/site/SiteContext";
import { fetchHotBatches } from "@/lib/data/queries";
import { describeRemaining, formatClock } from "@/lib/ambient/board";
import { coolingAlerts, onTheClock, type HotBatchLog } from "@/lib/cooling/board";
import { alertsEnabled, chime, markFired, notify, readFired } from "@/lib/ambient/alerts";

// Like the sandwich bar, under the store switcher on every page: when a warm
// batch is inside its last 30 minutes, or over its 2 hours, it's in view
// whatever screen the iPad is on. Uses the same alert switch and chime.

const REFRESH_MS = 60_000;
const TICK_MS = 15_000;

function readCache(key: string): HotBatchLog[] {
  try {
    const raw = window.localStorage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as HotBatchLog[]) : [];
  } catch {
    return [];
  }
}

export function CoolingAlertBar() {
  const { site } = useSite();
  const cacheKey = `cd-hot-batches:${site.id}`;
  const [logs, setLogs] = useState<HotBatchLog[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const fromCache = () => setLogs(readCache(cacheKey));
    const refresh = () =>
      fetchHotBatches(site.id)
        .then((rows) => {
          if (cancelled) return;
          window.localStorage.setItem(cacheKey, JSON.stringify(rows));
          setLogs(rows);
        })
        .catch(fromCache);
    fromCache();
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    // Saves elsewhere update the cache; pick them up on the tick.
    const tick = setInterval(() => { setNow(Date.now()); fromCache(); }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(tick);
    };
  }, [site.id, cacheKey]);

  const batches = useMemo(() => onTheClock(logs, now), [logs, now]);

  useEffect(() => {
    if (batches.length === 0) return;
    const fired = readFired();
    const due = coolingAlerts(batches, fired);
    if (due.length === 0) return;
    for (const alert of due) fired.add(alert.key);
    markFired(fired);
    if (!alertsEnabled()) return;
    chime();
    for (const alert of due) void notify(alert.title, alert.body, alert.key, "/cooling");
  }, [batches]);

  const worst = batches[0];
  if (!worst || worst.status === "ok") return null;
  const overdue = worst.status === "overdue";
  return (
    <Link href="/cooling" role="alert" className={`block px-4 py-3 print:hidden ${overdue ? "bg-danger text-white" : "bg-gold text-ink"}`}>
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
        <span className="font-bold">⏱ {overdue ? `${worst.productName}: 2 hours up, chill or bin now` : `${worst.productName}: ${describeRemaining(worst.msLeft)}`}</span>
        <span className="text-sm opacity-85 shrink-0">out {formatClock(worst.outAt)} · by {formatClock(worst.dueBy)} ›</span>
      </div>
    </Link>
  );
}
