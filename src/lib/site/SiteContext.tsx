"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchSites, type Site } from "@/lib/data/queries";

// Which shop is this device looking at? Persisted per device, so each
// shop's iPad stays on its own store across reloads; the switcher at the
// top of every page changes it. Every query and cache key downstream is
// scoped by site.id, so switching never mixes two shops' records.

const KEY = "cd-site";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

type SiteContextValue = {
  site: Site;
  sites: Site[];
  setSiteId: (id: string) => void;
};

const SiteContext = createContext<SiteContextValue | null>(null);

export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) throw new Error("useSite must be used inside SiteProvider");
  return value;
}

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const { data: sites, loading, error } = useCachedQuery("cd-sites", fetchSites);
  const stored = useSyncExternalStore(subscribe, readStored, () => null);

  const setSiteId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      // Selection still applies for this page load via the listeners below.
    }
    listeners.forEach((l) => l());
  }, []);

  const site = useMemo(() => {
    const list = sites ?? [];
    return list.find((s) => s.id === stored) ?? list[0] ?? null;
  }, [sites, stored]);

  const value = useMemo(
    () => (site ? { site, sites: sites ?? [], setSiteId } : null),
    [site, sites, setSiteId]
  );

  if (!value) {
    return (
      <main className="p-8 text-center text-ink-soft">
        {loading ? "Loading store…" : error ? "Connect to the internet once to load the store list." : "No stores set up yet."}
      </main>
    );
  }
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function SiteSwitcher() {
  const { site, sites, setSiteId } = useSite();
  if (sites.length < 2) return null;
  return (
    <div role="tablist" aria-label="Store" className="grid gap-1 rounded-xl bg-paper p-1 border border-line" style={{ gridTemplateColumns: `repeat(${sites.length}, minmax(0, 1fr))` }}>
      {sites.map((s) => {
        const active = s.id === site.id;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setSiteId(s.id)}
            className={`min-h-11 rounded-lg px-2 text-sm font-bold leading-tight transition-colors ${
              active ? "bg-brand text-white shadow-sm" : "text-ink-soft"
            }`}
          >
            {s.short_name}
          </button>
        );
      })}
    </div>
  );
}
