"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { HowLink } from "@/components/ui/HowLink";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { supabase } from "@/lib/supabase/client";
import { fetchActiveProducts, fetchAllStaff, fetchDeliveryLabels } from "@/lib/data/queries";
import { buildTrace, type TraceEvent } from "@/lib/trace/timeline";
import type { DeliveryLogRow } from "@/types/database";

// Trace a batch: pick the product and the days, and see its whole story in
// order. This is the answer to "a customer says they were ill after
// eating X on Thursday".

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ICON: Record<TraceEvent["kind"], string> = { delivery: "🚚", cooking: "🍳", cooling: "⏱", counter: "🥩", sandwich: "🥪" };

async function loadTrace(siteId: string, from: string, to: string, product: string): Promise<TraceEvent[]> {
  const start = new Date(`${from}T00:00:00`).toISOString();
  const endDate = new Date(`${to}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const end = endDate.toISOString();
  const range = <T extends string>(table: T) => supabase.from(table as "cooking_logs").select("*").eq("site_id", siteId).gte("recorded_at", start).lt("recorded_at", end).order("recorded_at").limit(1000);
  const [cooking, hot, counter, ambient] = await Promise.all([range("cooking_logs"), range("hot_batch_logs"), range("counter_stock_logs"), range("ambient_display_logs")]);
  for (const r of [cooking, hot, counter, ambient]) if (r.error) throw r.error;
  const counterRows = (counter.data ?? []) as unknown as Parameters<typeof buildTrace>[0]["counter"];
  const ids = [...new Set(counterRows.map((r) => r.delivery_log_id).filter((id): id is string => !!id))];
  const deliveries: DeliveryLogRow[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const { data, error } = await supabase.from("delivery_logs").select("*").in("id", ids.slice(i, i + 20));
    if (error) throw error;
    deliveries.push(...(data ?? []));
  }
  return buildTrace({
    cooking: (cooking.data ?? []) as unknown as Parameters<typeof buildTrace>[0]["cooking"],
    hotBatches: (hot.data ?? []) as unknown as Parameters<typeof buildTrace>[0]["hotBatches"],
    counter: counterRows,
    ambient: (ambient.data ?? []) as unknown as Parameters<typeof buildTrace>[0]["ambient"],
    deliveries,
    deliveryLabels: await fetchDeliveryLabels(ids),
  }, product);
}

export default function TracePage() {
  const { site } = useSite();
  const { data: products } = useCachedQuery("cd-products", fetchActiveProducts);
  const { data: staff } = useCachedQuery(`cd-all-staff:${site.id}`, () => fetchAllStaff(site.id));
  const [product, setProduct] = useState("");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return dateStr(d); });
  const [to, setTo] = useState(() => dateStr(new Date()));
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; events: TraceEvent[] }>({ status: "idle", events: [] });
  const name = (id: string) => (staff ?? []).find((s) => s.id === id)?.name ?? "";

  async function run() {
    setState({ status: "loading", events: [] });
    try {
      setState({ status: "done", events: await loadTrace(site.id, from, to, product) });
    } catch {
      setState({ status: "error", events: [] });
    }
  }

  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Trace a batch" />
      <div className="flex-1 px-4 py-5 max-w-2xl w-full mx-auto space-y-5">
        <div className="rounded-2xl bg-brand-soft border border-brand/20 px-5 py-4">
          <p className="font-bold text-brand-deep">Follow any food through the shop</p>
          <p className="mt-1 text-sm text-ink-soft">Pick what it was and when. You&apos;ll see when it was cooked and how hot, how it cooled, when it went in the counter and how it left.</p>
          <div className="mt-3"><HowLink method="product-recall" label="Complaint or recall: what to do" /></div>
        </div>
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">What was it?</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {(products ?? []).slice(0, 40).map((p) => (
              <button key={p.id} type="button" onClick={() => setProduct(product === p.name ? "" : p.name)} className={`h-11 rounded-full px-4 font-semibold ${product === p.name ? "bg-brand text-white" : "bg-surface border border-line"}`}>{p.name}</button>
            ))}
          </div>
          <input value={product} maxLength={200} onChange={(e) => setProduct(e.target.value)} placeholder="…or type it, e.g. sausage roll" className="w-full h-12 rounded-2xl border border-line bg-surface px-4 text-base focus:outline-none focus:border-brand" />
        </section>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold">From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="mt-1 w-full h-12 rounded-xl border border-line bg-surface px-2" /></label>
          <label className="text-sm font-semibold">To<input type="date" value={to} min={from} max={dateStr(new Date())} onChange={(e) => e.target.value && setTo(e.target.value)} className="mt-1 w-full h-12 rounded-xl border border-line bg-surface px-2" /></label>
        </div>
        <button type="button" onClick={run} disabled={state.status === "loading"} className="w-full h-14 rounded-2xl bg-brand text-white text-lg font-bold disabled:opacity-40">{state.status === "loading" ? "Looking…" : product.trim() ? `Trace ${product.trim()}` : "Show everything"}</button>
        {state.status === "error" && <p role="alert" className="text-danger">Couldn&apos;t load records. Check the internet connection.</p>}
        {state.status === "done" && state.events.length === 0 && <p className="text-ink-soft">No records for that in those days. Try a shorter name, e.g. “sausage”.</p>}
        {state.events.length > 0 && (
          <ol className="space-y-2">
            {state.events.map((e, i, list) => {
              const header = i === 0 || dayOf(list[i - 1].at) !== dayOf(e.at) ? dayOf(e.at) : null;
              return (
                <li key={i}>
                  {header && <p className="mt-4 mb-1.5 font-bold text-ink">{header}</p>}
                  <div className={`flex gap-3 rounded-xl border px-4 py-3 ${e.flag ? "bg-danger-soft border-danger/30" : "bg-surface border-line"}`}>
                    <span className="text-xl" aria-hidden>{ICON[e.kind]}</span>
                    <span className="flex-1 text-sm">
                      <span className="block font-semibold text-ink">{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {e.title}</span>
                      {e.detail && <span className="block text-ink-soft">{e.detail}</span>}
                      {name(e.staffId) && <span className="block text-ink-faint">{name(e.staffId)}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
