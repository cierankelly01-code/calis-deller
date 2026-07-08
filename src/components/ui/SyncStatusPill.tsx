"use client";

import { useEffect, useState } from "react";
import { startSyncLoop } from "@/lib/offline/sync";

// Lives in every header: quiet reassurance that nothing is lost when the
// wifi drops. Offline beats unsynced — staff care that saving still works,
// not about queue mechanics.
export function SyncStatusPill() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const stop = startSyncLoop(setRemaining);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      stop();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!online) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-full bg-ink text-paper text-xs font-semibold px-3 py-1.5"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
        Offline — still saving
      </span>
    );
  }

  if (remaining !== null && remaining > 0) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft text-gold-deep text-xs font-semibold px-3 py-1.5"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" aria-hidden />
        {remaining} syncing
      </span>
    );
  }

  return null;
}
