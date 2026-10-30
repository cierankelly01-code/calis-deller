"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { supabase } from "@/lib/supabase/client";
import { useSite } from "@/lib/site/SiteContext";
import { fetchContacts, type Contact } from "@/lib/data/queries";

// The SFBB contacts list for this shop: pest control, the council's food
// team, the plumber, the fridge engineer. Shown on the inspector page and in
// the printed book. Removing hides a contact; nothing is deleted.

const SUGGESTED = ["Pest control", "Environmental Health (council)", "Fridge engineer", "Plumber", "Electrician", "Waste collection"];

export default function ContactsSettingsPage() {
  const { site } = useSite();
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [role, setRole] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setRows((await fetchContacts(site.id)).filter((c) => c.active));
      window.localStorage.removeItem(`cd-contacts:${site.id}`);
    } catch {
      setError("Couldn't load — check the internet connection.");
    }
  }

  useEffect(() => {
    fetchContacts(site.id)
      .then((list) => setRows(list.filter((c) => c.active)))
      .catch(() => setError("Couldn't load — check the internet connection."));
  }, [site.id]);

  const phoneOk = phone.trim() === "" || /^[0-9 +()-]{3,40}$/.test(phone.trim());

  async function run(action: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError(null);
    try {
      const { error: writeError } = await action();
      if (writeError) throw writeError;
      await refresh();
    } catch {
      setError("Couldn't save — check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (!name.trim() || !phoneOk) return;
    const nextSort = Math.max(0, ...(rows ?? []).map((r) => r.sort_order)) + 1;
    void run(() => supabase.from("food_log_contacts").insert({ site_id: site.id, name: name.trim(), role: role.trim() || null, phone: phone.trim() || null, sort_order: nextSort }));
    setName(""); setRole(""); setPhone("");
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Contacts" backHref="/settings" />
      <div className="flex-1 px-4 py-6 max-w-2xl w-full mx-auto space-y-4">
        <p className="text-sm text-ink-soft">Who to call for {site.short_name}. Shown to the inspector and printed in the book.</p>
        {error && <p className="text-danger font-medium">{error}</p>}
        {rows === null && !error && <p className="text-ink-faint">Loading…</p>}
        <div className="space-y-2">
          {(rows ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface border border-line px-4 py-3">
              <p className="text-ink"><b>{c.role ?? "Contact"}:</b> {c.name}{c.phone && ` · ${c.phone}`}</p>
              <button type="button" disabled={busy} onClick={() => run(() => supabase.from("food_log_contacts").update({ active: false }).eq("id", c.id))} className="text-sm font-semibold text-danger disabled:opacity-40">Remove</button>
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-surface border border-line p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((s) => <button key={s} type="button" onClick={() => setRole(s)} className={`h-10 rounded-full px-3 text-sm font-semibold ${role === s ? "bg-brand text-white" : "bg-paper border border-line"}`}>{s}</button>)}
          </div>
          <input value={role} maxLength={200} onChange={(e) => setRole(e.target.value)} placeholder="What for, e.g. Pest control" className="w-full h-12 rounded-xl border border-line px-3" />
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Company or person" className="w-full h-12 rounded-xl border border-line px-3" />
          <input value={phone} maxLength={40} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="w-full h-12 rounded-xl border border-line px-3" />
          {!phoneOk && <p className="text-sm text-danger">Numbers, spaces and + ( ) - only.</p>}
          <button type="button" disabled={busy || !name.trim() || !phoneOk} onClick={add} className="w-full h-12 rounded-xl bg-brand text-white font-semibold disabled:opacity-40">Add contact</button>
        </div>
      </div>
    </div>
  );
}
