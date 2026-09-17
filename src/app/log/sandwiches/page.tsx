"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchActiveProducts, fetchAmbientDisplay } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { computeOffBy, formatClock, fridgeReserve, productKey, type AmbientLog } from "@/lib/ambient/board";

// One screen, two jobs, same quantity grid:
//   made    — "I've made these and they're in the fridge" (the day's reserve)
//   put_out — "these have just gone on top of the counter" (starts a 4-hour
//             timer on the lot; the server stamps the deadline)
// The line-up is every product flagged as a sandwich, plus any specials
// typed on the day. Putting out defaults to one of each that's in the fridge
// — "six out, six underneath" is the normal morning.

type Mode = "made" | "put_out";

type Line = { key: string; productId: string | null; productName: string; quantity: number; special: boolean };

function SandwichLogForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: products } = useCachedQuery("cd-products", fetchActiveProducts);
  const { data: logs } = useCachedQuery(`cd-ambient:${site.id}`, () => fetchAmbientDisplay(site.id));

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [mode, setMode] = useState<Mode>(params.get("mode") === "made" ? "made" : "put_out");
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [specials, setSpecials] = useState<Line[]>([]);
  const [specialName, setSpecialName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const reserve = useMemo(() => fridgeReserve(logs ?? []), [logs]);
  const reserveFor = (name: string) => reserve.find((r) => productKey(r.productName) === productKey(name))?.quantity ?? 0;

  // Line-up = sandwich products, plus anything in today's reserve that isn't
  // a product (a special made this morning), plus specials typed just now.
  const lines: Line[] = useMemo(() => {
    const list: Line[] = (products ?? [])
      .filter((p) => p.category === "sandwich")
      .map((p) => ({ key: productKey(p.name), productId: p.id, productName: p.name, quantity: 0, special: false }));
    for (const item of reserve) {
      if (!list.some((l) => l.key === productKey(item.productName))) {
        list.push({ key: productKey(item.productName), productId: item.productId, productName: item.productName, quantity: 0, special: true });
      }
    }
    for (const special of specials) {
      if (!list.some((l) => l.key === special.key)) list.push(special);
    }
    return list.map((line) => ({
      ...line,
      quantity: edits[line.key] ?? (mode === "put_out" ? Math.min(1, reserveFor(line.productName)) : 0),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, reserve, specials, edits, mode]);

  const chosen = lines.filter((l) => l.quantity > 0);
  const total = chosen.reduce((n, l) => n + l.quantity, 0);
  const overReserve = mode === "put_out" ? chosen.filter((l) => l.quantity > reserveFor(l.productName)) : [];

  function setQuantity(line: Line, quantity: number) {
    setEdits((current) => ({ ...current, [line.key]: Math.max(0, Math.min(200, quantity)) }));
  }

  function addSpecial() {
    const name = specialName.trim();
    if (!name) return;
    const key = productKey(name);
    if (!lines.some((l) => l.key === key)) {
      setSpecials((list) => [...list, { key, productId: null, productName: name, quantity: 0, special: true }]);
    }
    setEdits((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
    setSpecialName("");
  }

  const canSave = staffId !== null && total > 0 && !saving;
  const blocker = !staffId
    ? (staff ?? []).length === 0
      ? "No staff names set up yet — a manager adds them in Settings › Staff"
      : mode === "made" ? "Tap who made them first" : "Tap who's putting them out first"
    : total === 0
      ? mode === "made" ? "Add how many of each you've made" : "Pick what's going out"
      : null;

  async function handleSave() {
    if (!canSave || !staffId) return;
    setSaving(true);
    setSaveError(null);
    try {
      // One timestamp for the whole save: that's what groups a put-out into
      // a single timer on the board.
      const recordedAt = new Date();
      const rows: AmbientLog[] = [];
      for (const line of chosen) {
        const payload = {
          staff_id: staffId,
          event: mode,
          product_id: line.productId,
          product_name: line.productName.trim(),
          quantity: line.quantity,
          recorded_at: recordedAt.toISOString(),
        };
        const clientId = await queueEntry("ambient_display_logs", payload);
        rows.push({
          ...payload,
          id: clientId,
          client_id: clientId,
          batch_client_id: null,
          off_by: mode === "put_out" ? computeOffBy(recordedAt) : null,
          outcome: null,
          note: null,
        });
      }
      for (const row of rows) appendToTodayCache(`cd-ambient:${site.id}`, row);
      window.dispatchEvent(new Event("ambient-changed"));
      void syncOutbox().catch(() => {});
      setShowSaved(true);
      setTimeout(() => {
        setShowSaved(false);
        router.push("/sandwiches");
      }, 700);
    } catch (err) {
      setSaveError(
        `Could not save on this device: ${err instanceof Error ? err.message : "unknown error"}. Check the fields, device time and available storage, then retry.`
      );
    } finally {
      setSaving(false);
    }
  }

  const offBy = formatClock(computeOffBy(new Date()));

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title={mode === "made" ? "Sandwiches Made" : "Sandwiches Out"} backHref="/sandwiches" />
      <SavedOverlay
        show={showSaved}
        message={mode === "made" ? `${total} in the fridge` : `${total} out — off by ${offBy}`}
      />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <div className="grid grid-cols-2 gap-2.5">
          {([
            { key: "made", label: "🧊 Made & in the fridge", sub: "today's reserve" },
            { key: "put_out", label: "☀️ Put out on the counter", sub: "starts the 4-hour clock" },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setMode(option.key);
                setEdits({});
              }}
              className={`min-h-16 rounded-2xl px-3 py-2 text-sm font-semibold transition-all active:scale-95 ${
                mode === option.key ? "bg-brand text-white shadow-sm" : "bg-surface text-ink border border-line shadow-sm"
              }`}
            >
              {option.label}
              <span className={`block text-xs font-normal ${mode === option.key ? "text-white/75" : "text-ink-soft"}`}>{option.sub}</span>
            </button>
          ))}
        </div>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            {mode === "made" ? "Who made them?" : "Who's putting them out?"}
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-1">
            {mode === "made" ? "How many of each?" : "What's going out?"}
          </h2>
          <p className="text-sm text-ink-soft mb-3">
            {mode === "made"
              ? "Everything you've made and chilled. Sandwiches are products — add new regulars in the Allergen Guide."
              : "Only sandwiches straight from the fridge that have never been out before. Anything that's already had its four hours stays chilled."}
          </p>
          {lines.length === 0 && (
            <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
              No sandwiches set up yet — add them in the Allergen Guide and mark them as “Sandwich”, or type a special below.
            </p>
          )}
          <div className="space-y-2">
            {lines.map((line) => {
              const inFridge = reserveFor(line.productName);
              const over = mode === "put_out" && line.quantity > inFridge;
              return (
                <div
                  key={line.key}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                    line.quantity > 0 ? "bg-brand-soft border-brand/30" : "bg-surface border-line"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">
                      {line.productName}
                      {line.special && <span className="ml-2 text-xs font-bold uppercase tracking-wider text-gold-deep">special</span>}
                    </p>
                    <p className={`text-xs ${over ? "text-danger font-semibold" : "text-ink-soft"}`}>
                      {mode === "put_out"
                        ? over
                          ? `Only ${inFridge} logged in the fridge — carry on if they're fresh from the fridge`
                          : `${inFridge} in the fridge`
                        : inFridge > 0
                          ? `${inFridge} already in the fridge today`
                          : "none in the fridge yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setQuantity(line, line.quantity - 1)}
                      className="h-12 w-12 rounded-xl bg-surface border border-line shadow-sm text-xl font-bold text-ink active:scale-95"
                      aria-label={`Fewer ${line.productName}`}
                    >
                      −
                    </button>
                    <div className="h-12 w-14 flex items-center justify-center rounded-xl bg-ink text-paper text-2xl font-mono tabular-nums">
                      {line.quantity}
                    </div>
                    <button
                      type="button"
                      onClick={() => setQuantity(line, line.quantity + 1)}
                      className="h-12 w-12 rounded-xl bg-surface border border-line shadow-sm text-xl font-bold text-ink active:scale-95"
                      aria-label={`More ${line.productName}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2">
            Today&apos;s special?
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={specialName}
              maxLength={200}
              onChange={(e) => setSpecialName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSpecial();
                }
              }}
              placeholder="e.g. Coronation Chicken"
              className="flex-1 min-w-0 h-12 rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-ink-faint focus:outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={addSpecial}
              disabled={specialName.trim().length === 0}
              className="h-12 rounded-2xl bg-ink text-paper px-4 font-semibold disabled:opacity-40 active:scale-95"
            >
              + Add
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-ink text-paper px-5 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.18em] text-paper/60 font-bold">
            {mode === "made" ? "Going in the fridge" : "Going out now"}
          </p>
          <p className="mt-1 text-2xl font-bold">
            {total} sandwich{total === 1 ? "" : "es"}
            {mode === "put_out" && total > 0 && <span className="text-base font-semibold text-paper/80"> · off by {offBy}</span>}
          </p>
          <p className="mt-1 text-sm text-paper/70">
            {mode === "made"
              ? "Chilled at 8°C or below until they go out. Made today, sold today."
              : "Less than four hours at room temperature, once only. The app will count down and alert before time."}
          </p>
          {overReserve.length > 0 && (
            <p className="mt-2 text-sm text-gold font-semibold">
              {overReserve.map((l) => l.productName).join(", ")}: more than logged in the fridge — fine if they were made this morning, but never put out anything that has already been out.
            </p>
          )}
        </section>
      </div>

      <SaveBar
        disabled={!canSave}
        saving={saving}
        saved={false}
        onSave={handleSave}
        label={mode === "made" ? "In the fridge" : "They're out — start the clock"}
        hint={blocker}
      />
    </div>
  );
}

export default function SandwichLogPage() {
  return (
    <Suspense fallback={<div className="flex flex-col flex-1"><PageHeader title="Sandwiches" backHref="/sandwiches" /></div>}>
      <SandwichLogForm />
    </Suspense>
  );
}
