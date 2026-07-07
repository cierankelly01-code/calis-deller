"use client";

import { useEffect, useState } from "react";
import { startSyncLoop } from "@/lib/offline/sync";

// Persistent visible confirmation that offline entries are queued, not
// lost — important for staff trusting the tool while wifi is flaky.
export function UnsyncedBadge() {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const stop = startSyncLoop(setRemaining);
    return stop;
  }, []);

  if (remaining === null || remaining === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-amber-500 text-white text-sm font-medium px-3 py-2 rounded-full shadow-lg">
      ● {remaining} unsynced
    </div>
  );
}
