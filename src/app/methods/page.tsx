"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchMethodRecords } from "@/lib/data/queries";
import { METHOD_GROUPS, SAFE_METHODS } from "@/lib/methods/content";
import { currentSignOffs } from "@/lib/methods/records";
import { methodIcon } from "@/lib/methods/icons";
import { Icon, IconTile } from "@/components/ui/Icon";

// The book: every safe method, grouped as in the SFBB pack, with a search
// box for "how do I…?" and a tick for each one this shop has signed off.

export default function MethodsPage() {
  const { site } = useSite();
  const { data: records } = useCachedQuery(`cd-method-records:${site.id}`, () => fetchMethodRecords(site.id));
  const signed = useMemo(() => currentSignOffs(records ?? []), [records]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (m: (typeof SAFE_METHODS)[number]) =>
    !q || [m.title, m.oneLine, ...m.steps].some((t) => t.toLowerCase().includes(q));

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="How to do it" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        <div className="rounded-2xl bg-brand-soft border border-brand/20 px-5 py-4">
          <p className="font-bold text-brand-deep text-lg">How we do things safely</p>
          <p className="mt-1 text-sm text-ink-soft">
            Step by step, from the official Safer Food, Better Business pack. Pick the job you&apos;re doing. {signed.size} of {SAFE_METHODS.length} signed off for {site.short_name}.
          </p>
          <Link href="/book" className="mt-3 inline-block text-sm font-semibold text-brand underline">Print the whole book</Link>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search: wash up, cool, allergy…"
          className="w-full h-12 rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-ink-faint focus:outline-none focus:border-brand"
        />
        {METHOD_GROUPS.map((group) => {
          const list = SAFE_METHODS.filter((m) => m.group === group.id && matches(m));
          if (list.length === 0) return null;
          return (
            <section key={group.id}>
              <h2 className="section-title mb-2.5">{group.title}</h2>
              <div className="space-y-2">
                {list.map((m) => (
                  <Link key={m.id} href={`/methods/${m.id}`} className="flex items-center gap-3.5 rounded-2xl bg-surface border border-line px-4 py-3.5 active:scale-[0.99] transition-transform">
                    <IconTile name={methodIcon(m.id, m.group)} size="sm" />
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-ink">{m.title}</span>
                      <span className="block text-sm text-ink-soft truncate">{m.oneLine}</span>
                    </span>
                    {signed.has(m.id) ? <span className="text-brand" role="img" aria-label="Signed off"><Icon name="check" size={20} strokeWidth={2.5} /></span> : <Icon name="chevron" className="text-ink-faint" size={20} />}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        <p className="text-xs text-ink-faint">Contains public sector information licensed under the Open Government Licence v3.0 (Food Standards Agency, Safer food, better business).</p>
      </div>
    </div>
  );
}
