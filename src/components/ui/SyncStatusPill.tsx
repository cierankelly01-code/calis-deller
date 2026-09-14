"use client";

import { useEffect, useState } from "react";
import { getLastSyncError, startSyncLoop } from "@/lib/offline/sync";

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

  if (remaining === -1) return <span role="alert" className="text-danger text-xs">Sync needs attention — entries kept on device</span>;

  if (remaining !== null && remaining > 0) {
    const reason = getLastSyncError();
    if (reason) {
      return (
        <span role="alert" className="inline-flex max-w-[60vw] items-center gap-1.5 rounded-full bg-danger-soft text-danger-deep text-xs font-semibold px-3 py-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
          <span className="truncate">{remaining} not accepted by server: {reason}</span>
        </span>
      );
    }
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft text-gold-deep text-xs font-semibold px-3 py-1.5"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" aria-hidden />
        {remaining} saved on device · awaiting sync
      </span>
    );
  }

  return null;
}
