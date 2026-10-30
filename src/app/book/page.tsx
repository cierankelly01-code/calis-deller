"use client";

import { useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveSuppliers, fetchAllStaff, fetchContacts, fetchMethodRecords } from "@/lib/data/queries";
import { METHOD_GROUPS, SAFE_METHODS } from "@/lib/methods/content";
import { currentSignOffs, formatDate } from "@/lib/methods/records";

// The printed book: the paper copy that lives in the shop. Every safe
// method with this shop's own way and its sign-off, then contacts and
// suppliers. Print → Save as PDF on the iPad makes the PDF.

export default function BookPage() {
  const { site } = useSite();
  const { data: records } = useCachedQuery(`cd-method-records:${site.id}`, () => fetchMethodRecords(site.id));
  const { data: staff } = useCachedQuery(`cd-all-staff:${site.id}`, () => fetchAllStaff(site.id));
  const { data: contacts } = useCachedQuery(`cd-contacts:${site.id}`, () => fetchContacts(site.id));
  const { data: suppliers } = useCachedQuery(`cd-suppliers:${site.id}`, () => fetchActiveSuppliers(site.id));
  const signed = useMemo(() => currentSignOffs(records ?? []), [records]);
  const name = (id: string) => (staff ?? []).find((s) => s.id === id)?.name ?? "";
  const printed = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="The book" backHref="/inspector" />
      <div className="px-4 pt-4 max-w-2xl w-full mx-auto print:hidden">
        <button type="button" onClick={() => window.print()} className="w-full h-14 rounded-2xl bg-brand text-white text-lg font-bold"><span className="inline-flex items-center gap-2"><Icon name="printer" />Print or save as PDF</span></button>
        <p className="mt-2 text-sm text-ink-soft text-center">Keep the printed copy in the shop. Print again after a method is signed off.</p>
      </div>
      <article className="flex-1 px-4 py-6 max-w-2xl w-full mx-auto space-y-8 print:max-w-none print:px-0 text-ink">
        <header className="text-center space-y-1 border-b border-line pb-6">
          <p className="font-display text-3xl font-semibold">{site.name}</p>
          <p className="text-lg">Food safety: our safe methods</p>
          <p className="text-sm text-ink-soft">Safer Food, Better Business, written for our staff. Printed {printed}. Daily records are kept on the tablet and cannot be edited or deleted.</p>
        </header>

        {METHOD_GROUPS.map((group) => (
          <section key={group.id} className="space-y-6 print:break-before-page">
            <h2 className="font-display text-2xl font-semibold border-b-2 border-ink pb-1">{group.title}</h2>
            {SAFE_METHODS.filter((m) => m.group === group.id).map((m) => {
              const record = signed.get(m.id);
              return (
                <div key={m.id} className="space-y-2 break-inside-avoid">
                  <h3 className="text-xl font-bold">{m.title}</h3>
                  <p className="text-ink-soft">{m.oneLine}</p>
                  <ol className="list-decimal pl-6 space-y-0.5">{m.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  {m.needsProduct && !record?.our_way && <p className="text-sm">Product and contact time: ____________________________</p>}
                  <p className="text-sm"><b>Why:</b> {m.why}</p>
                  <div className="text-sm"><b>If it goes wrong:</b>
                    <ul className="list-disc pl-6">{m.wrong.map((w, i) => <li key={i}>{w.problem} → {w.fix}</li>)}</ul>
                  </div>
                  <div className="rounded-lg border border-line px-3 py-2 text-sm">
                    <p><b>How we do it here:</b> {record?.our_way ?? "________________________________________"}</p>
                    <p className="mt-1">{record ? <>Signed off by {name(record.staff_id)}, {formatDate(record.recorded_at)}</> : "Signed off by: ______________  Date: __________"}</p>
                  </div>
                </div>
              );
            })}
          </section>
        ))}

        <section className="space-y-3 print:break-before-page">
          <h2 className="font-display text-2xl font-semibold border-b-2 border-ink pb-1">Contacts and suppliers</h2>
          <ul className="space-y-0.5">
            {(contacts ?? []).filter((c) => c.active).map((c) => <li key={c.id}><b>{c.role ?? "Contact"}:</b> {c.name}{c.phone && ` · ${c.phone}`}</li>)}
            {(contacts ?? []).filter((c) => c.active).length === 0 && <li>Contacts: add them in Settings › Contacts.</li>}
          </ul>
          <p><b>Suppliers:</b> {(suppliers ?? []).map((s) => s.name).join(", ") || "none listed"}</p>
        </section>
        <p className="text-xs text-ink-soft">Contains public sector information licensed under the Open Government Licence v3.0. Adapted from the Food Standards Agency&apos;s Safer food, better business packs.</p>
      </article>
    </div>
  );
}
