"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useMemo } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useUser } from "@/components/auth/AuthBoundary";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { supabase } from "@/lib/supabase/client";
import { fetchActiveStaff, fetchActiveSuppliers, fetchContacts, fetchInductions, fetchMethodRecords, fetchReviews } from "@/lib/data/queries";
import { inductionProgress } from "@/lib/training/induction";
import { signOffProgress, formatDate } from "@/lib/methods/records";
import { lateFinishes } from "@/lib/cooling/board";

// The inspector button. One screen to hand the officer: what we record, the
// last four weeks at a glance (every problem with what was done about it),
// and a way into each part. Everything here is read-only.

type Tally = { label: string; href: string; total: number; problems: number };

async function fetchLast28(siteId: string): Promise<Tally[]> {
  const since = new Date();
  since.setDate(since.getDate() - 28);
  since.setHours(0, 0, 0, 0);
  const iso = since.toISOString();
  const q = (table: "fridge_temp_logs" | "cooking_logs" | "delivery_logs" | "cleaning_logs" | "probe_calibration_logs" | "hot_batch_logs" | "site_check_logs", columns: string) =>
    supabase.from(table).select(columns).eq("site_id", siteId).gte("recorded_at", iso).limit(5000);
  const [fridge, cooking, delivery, cleaning, probe, hot, checks] = await Promise.all([
    q("fridge_temp_logs", "in_range"), q("cooking_logs", "in_range"), q("delivery_logs", "accepted"), q("cleaning_logs", "id"),
    q("probe_calibration_logs", "pass"), q("hot_batch_logs", "id,client_id,event,batch_client_id,due_by,recorded_at"), q("site_check_logs", "ok"),
  ]);
  for (const r of [fridge, cooking, delivery, cleaning, probe, hot, checks]) if (r.error) throw r.error;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Record<string, unknown>[];
  return [
    { label: "Fridge and freezer temperatures", href: "/diary", total: rows(fridge).length, problems: rows(fridge).filter((r) => r.in_range === false).length },
    { label: "Cooking, reheating and hot holding", href: "/diary", total: rows(cooking).length, problems: rows(cooking).filter((r) => r.in_range === false).length },
    { label: "Cooling clock batches", href: "/cooling", total: rows(hot).filter((r) => r.event === "out").length, problems: lateFinishes(rows(hot) as unknown as Parameters<typeof lateFinishes>[0]).size },
    { label: "Deliveries checked", href: "/diary", total: rows(delivery).length, problems: rows(delivery).filter((r) => r.accepted === false).length },
    { label: "Cleaning tasks ticked off", href: "/diary", total: rows(cleaning).length, problems: 0 },
    { label: "Probe accuracy checks", href: "/log/probe", total: rows(probe).length, problems: rows(probe).filter((r) => r.pass === false).length },
    { label: "Hand sink, pest and repair checks", href: "/checks", total: rows(checks).length, problems: rows(checks).filter((r) => r.ok === false).length },
  ];
}

export default function InspectorPage() {
  const user = useUser();
  const { site } = useSite();
  const { data: tallies, error } = useCachedQuery(`cd-inspector:${site.id}`, () => fetchLast28(site.id));
  const { data: records } = useCachedQuery(`cd-method-records:${site.id}`, () => fetchMethodRecords(site.id));
  const { data: reviews } = useCachedQuery(`cd-reviews:${site.id}`, () => fetchReviews(site.id));
  const { data: contacts } = useCachedQuery(`cd-contacts:${site.id}`, () => fetchContacts(site.id));
  const { data: suppliers } = useCachedQuery(`cd-suppliers:${site.id}`, () => fetchActiveSuppliers(site.id));
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: inductions } = useCachedQuery(`cd-inductions:${site.id}`, () => fetchInductions(site.id));
  const trained = useMemo(() => (staff ?? []).map((p) => ({ name: p.name, ...inductionProgress(inductions ?? [], p.id) })), [staff, inductions]);
  const progress = useMemo(() => signOffProgress(records ?? []), [records]);
  const lastReview = reviews?.[0] ?? null;

  const card = "flex items-center justify-between gap-3 rounded-2xl bg-surface border border-line px-5 py-4 active:scale-[0.99] transition-transform";

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="For the inspector" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-6">
        <section className="rounded-2xl bg-ink text-paper px-5 py-5">
          <p className="text-xs uppercase tracking-[0.18em] text-paper/60 font-bold">Food safety management</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{site.name}</h2>
          <p className="mt-2 text-sm text-paper/80 leading-relaxed">
            Our system is Safer Food, Better Business, kept on this tablet. Every check is saved with who did it and when.
            Records can&apos;t be edited or deleted. A reading out of range must say what was done about it, and anything late is flagged. The written safe
            methods are in the app for each shop, and print as a book.
          </p>
        </section>

        <Link href="/methods" className={card}>
          <span><span className="block font-bold text-ink"><span className="inline-flex items-center gap-2"><Icon name="book" size={20} className="text-brand" />Our safe methods</span></span><span className="block text-sm text-ink-soft">{progress.signed} of {progress.total} signed off for {site.short_name} · step by step for staff</span></span><Icon name="chevron" className="text-ink-faint" />
        </Link>
        <Link href="/book" className={card}>
          <span><span className="block font-bold text-ink"><span className="inline-flex items-center gap-2"><Icon name="printer" size={20} className="text-brand" />Print the book</span></span><span className="block text-sm text-ink-soft">All methods with our own way of working, contacts and suppliers</span></span><Icon name="chevron" className="text-ink-faint" />
        </Link>

        <section>
          <h2 className="section-title mb-2.5">Last 4 weeks</h2>
          {error && !tallies && <p className="text-danger">Needs the internet to count the records.</p>}
          <div className="rounded-2xl bg-surface border border-line divide-y divide-line">
            {(tallies ?? []).map((t) => (
              <Link key={t.label} href={t.href} className="flex items-center justify-between px-5 py-3">
                <span className="text-ink">{t.label}</span>
                <span className="text-right text-sm"><b className="text-ink tabular-nums">{t.total}</b>{t.problems > 0 && <span className="block text-gold-deep">{t.problems} flagged: see the diary</span>}</span>
              </Link>
            ))}
          </div>
          <Link href="/diary" className="mt-2 inline-block font-semibold text-brand underline">Open any day in the diary, or export it</Link>
        </section>

        <section className="rounded-2xl bg-surface border border-line px-5 py-4">
          <h2 className="font-bold text-ink">Staff trained on our safe methods</h2>
          <p className="mt-1 text-sm text-ink-soft">Each person reads the methods on this iPad and confirms they understood, under their own name. {trained.filter((t) => t.complete).length} of {trained.length} done.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {trained.map((t) => <li key={t.staffId} className="flex justify-between gap-3"><span className="text-ink">{t.name}</span><span className={t.complete ? "text-brand font-semibold" : "text-gold-deep"}>{t.complete ? `✓ ${t.completedAt ? formatDate(t.completedAt) : ""}` : `${t.done} of ${t.total}`}</span></li>)}
          </ul>
        </section>

        <Link href="/trace" className={card}>
          <span><span className="block font-bold text-ink"><span className="inline-flex items-center gap-2"><Icon name="search" size={20} className="text-brand" />Trace a batch</span></span><span className="block text-sm text-ink-soft">Any product: cooked, cooled, counter, sold or binned</span></span><Icon name="chevron" className="text-ink-faint" />
        </Link>
        <Link href="/allergens" className={card}>
          <span><span className="block font-bold text-ink"><span className="inline-flex items-center gap-2"><Icon name="alert" size={20} className="text-brand" />Allergen guide</span></span><span className="block text-sm text-ink-soft">The 14 allergens for every product we sell</span></span><Icon name="chevron" className="text-ink-faint" />
        </Link>
        <Link href={user?.role === "manager" ? "/training" : "/inspector"} className={card} aria-disabled={user?.role !== "manager"}>
          <span><span className="block font-bold text-ink"><span className="inline-flex items-center gap-2"><Icon name="cap" size={20} className="text-brand" />Staff training and certificates</span></span><span className="block text-sm text-ink-soft">{user?.role === "manager" ? "Each person's certificate and the methods they've been shown" : "Private: the manager signs in to show this"}</span></span><Icon name="chevron" className="text-ink-faint" />
        </Link>
        <Link href="/review" className={card}>
          <span><span className="block font-bold text-ink"><span className="inline-flex items-center gap-2"><Icon name="calendar" size={20} className="text-brand" />4-weekly reviews</span></span><span className="block text-sm text-ink-soft">{lastReview ? `Last one ${formatDate(lastReview.recorded_at)}` : "None yet"}</span></span><Icon name="chevron" className="text-ink-faint" />
        </Link>
        <Link href="/health" className={card}>
          <span><span className="block font-bold text-ink"><span className="inline-flex items-center gap-2"><Icon name="ill" size={20} className="text-brand" />Fit for work</span></span><span className="block text-sm text-ink-soft">Our sickness rule and return-to-work record</span></span><Icon name="chevron" className="text-ink-faint" />
        </Link>

        <section className="rounded-2xl bg-surface border border-line px-5 py-4">
          <h2 className="font-bold text-ink">Suppliers</h2>
          <p className="mt-1 text-sm text-ink-soft">{(suppliers ?? []).map((s) => s.name).join(" · ") || "None listed yet"}</p>
          <h2 className="mt-4 font-bold text-ink">Contacts</h2>
          {(contacts ?? []).filter((c) => c.active).length === 0 ? <p className="mt-1 text-sm text-ink-soft">None listed yet{user?.role === "manager" && <> · <Link href="/settings/contacts" className="underline text-brand">add them</Link></>}</p> : (
            <ul className="mt-1 text-sm text-ink space-y-0.5">
              {(contacts ?? []).filter((c) => c.active).map((c) => <li key={c.id}><b>{c.role ?? "Contact"}:</b> {c.name}{c.phone && ` · ${c.phone}`}</li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
