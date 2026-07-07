"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Never register in dev: the cache-first fetch handler serves stale
    // hashed chunks against Fast Refresh's live rebuilds, which causes a
    // reload loop. Production builds get long-lived hashed filenames the
    // cache strategy is actually designed for.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.error("Service worker registration failed", error);
    });
  }, []);

  return null;
}
