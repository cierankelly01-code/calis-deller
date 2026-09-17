"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSite } from "@/lib/site/SiteContext";
import { fetchAmbientDisplay } from "@/lib/data/queries";
import { describeRemaining, dueAlerts, formatClock, outNow, type AmbientLog } from "@/lib/ambient/board";
import { alertsEnabled, chime, markFired, notify, readFired } from "@/lib/ambient/alerts";

// Sits under the store switcher on every page: whichever screen the iPad is
// on when the sandwiches are running out of time, the countdown is in view.
// Also the one place the timed alerts fire from, so they fire exactly once
// per batch per stage no matter how many screens have been opened.

const REFRESH_MS = 60_000;
const TICK_MS = 15_000;

function readCache(key: string): AmbientLog[] {
  try {
    const raw = window.localStorage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as AmbientLog[]) : [];
  } catch {
    return [];
  }
}

export function AmbientAlertBar() {
  const { site } = useSite();
  const cacheKey = `cd-ambient:${site.id}`;
  const [logs, setLogs] = useState<AmbientLog[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const fromCache = () => setLogs(readCache(cacheKey));
    const refresh = () =>
      fetchAmbientDisplay(site.id)
        .then((rows) => {
          if (cancelled) return;
          window.localStorage.setItem(cacheKey, JSON.stringify(rows));
          setLogs(rows);
        })
        .catch(fromCache);
    fromCache();
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    window.addEventListener("ambient-changed", fromCache);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(tick);
      window.removeEventListener("ambient-changed", fromCache);
    };
  }, [site.id, cacheKey]);

  const groups = useMemo(() => outNow(logs, now), [logs, now]);

  // Fire whatever is due, once. Persisted so a reload doesn't repeat it.
  useEffect(() => {
    if (groups.length === 0) return;
    const fired = readFired();
    const due = dueAlerts(groups, fired);
    if (due.length === 0) return;
    for (const alert of due) fired.add(alert.key);
    markFired(fired);
    if (!alertsEnabled()) return;
    chime();
    for (const alert of due) void notify(alert.title, alert.body, alert.key);
  }, [groups]);

  const worst = groups[0];
  if (!worst || worst.status === "ok") return null;

  const overdue = worst.status === "overdue";
  return (
    <Link
      href="/sandwiches"
      role="alert"
      className={`block px-4 py-3 print:hidden ${overdue ? "bg-danger text-white" : "bg-gold text-ink"}`}
    >
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
        <span className="font-bold">
          🥪 {overdue ? "Take the sandwiches off now" : `Sandwiches: ${describeRemaining(worst.msLeft)}`}
        </span>
        <span className="text-sm opacity-85 shrink-0">
          {worst.quantity} out since {formatClock(worst.outAt)} · off by {formatClock(worst.offBy)} ›
        </span>
      </div>
    </Link>
  );
}
