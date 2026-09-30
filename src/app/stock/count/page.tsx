"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { useUser } from "@/components/auth/AuthBoundary";
import {
  fetchActiveProducts,
  fetchActiveStaff,
  fetchAmbientSince,
  fetchCounterStock,
  fetchRecentDeliveries,
  fetchStockLines,
  fetchStockLogs,
} from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { localDateStr } from "@/lib/counter/board";
import { productKey } from "@/lib/ambient/board";
import { TAG_LABELS, formatQty, formatShortDay, lastCountsBefore, logDay, shiftDay, type StockLog } from "@/lib/stock/ledger";
import { parseAmount, trackedLines, type TrackedLine } from "@/lib/stock/lines";

// The close count: one screen, one pass round the shop. For each tracked
// line — what came in since the last count, what was binned, what's left
// now. Sold is worked out live so a miscount shows before it's saved.
// Sandwiches pre-fill from the sandwich log (made = came in, binned = the
// bin), and counter batches binned since the last count are pointed out so
// their weight isn't forgotten. The half-done count is kept on the device,
// so walking off to serve someone doesn't lose it.

type Field = "cameIn" | "binned" | "left";
type Draft = { values: Record<string, Partial<Record<Field, string>>>; tags: string[]; note: string };

const EMPTY: Draft = { values: {}, tags: [], note: "" };

function readDraft(key: string): Draft {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export default function StockCountPage() {
  const router = useRouter();
  const user = useUser();
  const { site } = useSite();
  const today = localDateStr(new Date());
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: products } = useCachedQuery("cd-products", fetchActiveProducts);
  const { data: lines } = useCachedQuery("cd-stock-lines", fetchStockLines);
  const { data: stockLogs } = useCachedQuery(`cd-stock-logs:${site.id}`, () => fetchStockLogs(site.id));
  const { data: counterLogs } = useCachedQuery(`cd-counter-stock:${site.id}`, () => fetchCounterStock(site.id));
  const { data: deliveries } = useCachedQuery(`cd-recent-deliveries:${site.id}`, () => fetchRecentDeliveries(site.id));
  // A week back covers any sensible gap since the last count.
  const { data: ambientLogs } = useCachedQuery(`cd-ambient-week:${site.id}`, () => fetchAmbientSince(site.id, shiftDay(today, -7)));
  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);

  const draftKey = `cd-stock-draft:${site.id}:${today}`;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [draftLoaded, setDraftLoaded] = useState<string | null>(null);
  useEffect(() => {
    // Restoring from localStorage has to wait for the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(readDraft(draftKey));
    setDraftLoaded(draftKey);
  }, [draftKey]);
  useEffect(() => {
    if (draftLoaded !== draftKey) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Best-effort: the count still saves without a draft.
    }
  }, [draft, draftKey, draftLoaded]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const tracked = useMemo(() => trackedLines(lines ?? [], products ?? []), [lines, products]);
  const logs = useMemo(() => stockLogs ?? [], [stockLogs]);
  const lastCounts = useMemo(() => lastCountsBefore(logs, today), [logs, today]);
  const countedToday = useMemo(() => {
    const map = new Map<string, StockLog>();
    for (const log of logs) if (log.event === "count" && logDay(log) === today && log.product_id && !map.has(log.product_id)) map.set(log.product_id, log);
    return map; // logs arrive newest first, so the first seen is the latest
  }, [logs, today]);

  // "Since the last count" = from the day after it, or today if never counted.
  const sinceDay = (line: TrackedLine) => {
    const last = lastCounts.get(line.productId);
    return last ? shiftDay(logDay(last), 1) : today;
  };

  const suggestions = useMemo(() => {
    const map = new Map<string, { cameIn?: number; binned?: number; batchesBinned?: number }>();
    for (const line of tracked) {
      const from = sinceDay(line);
      const matches = (id: string | null, name: string) => (id ? id === line.productId : productKey(name) === productKey(line.name));
      const s: { cameIn?: number; binned?: number; batchesBinned?: number } = {};
      if (line.category === "sandwich") {
        const inWindow = (ambientLogs ?? []).filter((l) => localDateStr(new Date(l.recorded_at)) >= from && matches(l.product_id, l.product_name));
        s.cameIn = inWindow.filter((l) => l.event === "made").reduce((n, l) => n + l.quantity, 0);
        s.binned = inWindow.filter((l) => l.event === "taken_off" && l.outcome === "binned").reduce((n, l) => n + l.quantity, 0);
      } else {
        s.batchesBinned = (counterLogs ?? []).filter(
          (l) => l.event === "taken_off" && (l.reason === "end_of_life" || l.reason === "quality") && localDateStr(new Date(l.recorded_at)) >= from && matches(l.product_id, l.product_name)
        ).length;
      }
      map.set(line.productId, s);
    }
    return map;
    // sinceDay reads lastCounts/today, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, ambientLogs, counterLogs, lastCounts, today]);

  const earliestSince = tracked.length ? tracked.map(sinceDay).sort()[0] : today;
  const recentDeliveries = (deliveries ?? []).filter((d) => localDateStr(new Date(d.recorded_at)) >= earliestSince);

  // What a field shows: the user's typing, else the suggestion, else blank.
  const valueOf = (line: TrackedLine, field: Field): string => {
    const typed = draft.values[line.productId]?.[field];
    if (typed !== undefined) return typed;
    const s = suggestions.get(line.productId);
    const suggested = field === "cameIn" ? s?.cameIn : field === "binned" ? s?.binned : undefined;
    return suggested ? String(suggested) : "";
  };
  const setValue = (line: TrackedLine, field: Field, text: string) =>
    setDraft((d) => ({ ...d, values: { ...d.values, [line.productId]: { ...d.values[line.productId], [field]: text } } }));

  type Row = { line: TrackedLine; cameIn: number | null; binned: number | null; left: number | null; entered: boolean; invalid: boolean; sold: number | null };
  const rows: Row[] = tracked.map((line) => {
    const texts = { cameIn: valueOf(line, "cameIn"), binned: valueOf(line, "binned"), left: valueOf(line, "left") };
    const cameIn = texts.cameIn.trim() === "" ? 0 : parseAmount(texts.cameIn);
    const binned = texts.binned.trim() === "" ? 0 : parseAmount(texts.binned);
    const left = texts.left.trim() === "" ? null : parseAmount(texts.left);
    const entered = texts.left.trim() !== "";
    const invalid = cameIn == null || binned == null || (entered && left == null) || [cameIn, binned, left].some((v) => v != null && v > 100000);
    const last = lastCounts.get(line.productId);
    const sold = !invalid && entered && last?.on_hand != null ? Math.round((last.on_hand + cameIn! - binned! - left!) * 1000) / 1000 : null;
    return { line, cameIn, binned, left, entered, invalid, sold };
  });
  const toSave = rows.filter((r) => r.entered && !r.invalid);
  const invalidRows = rows.filter((r) => r.invalid);
  const hasNote = draft.tags.length > 0 || draft.note.trim().length > 0;

  const canSave = !!staffId && invalidRows.length === 0 && (toSave.length > 0 || hasNote) && !saving;
  const blocker = !staffId
    ? (staff ?? []).length === 0 ? "No staff names set up yet — a manager adds them in Settings › Staff" : "Tap who's counting first"
    : invalidRows.length > 0 ? `Check the numbers for ${invalidRows.map((r) => r.line.name).join(", ")}`
    : toSave.length === 0 && !hasNote ? "Fill in “Left now” for what you've counted"
    : null;

  async function handleSave() {
    if (!canSave || !staffId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const recordedAt = new Date().toISOString();
      const queued: StockLog[] = [];
      for (const row of toSave) {
        const payload = {
          staff_id: staffId,
          event: "count" as const,
          product_id: row.line.productId,
          product_name: row.line.name,
          unit: row.line.unit,
          came_in: row.cameIn!,
          binned: row.binned!,
          on_hand: row.left!,
          tags: [],
          note: null,
          recorded_at: recordedAt,
        };
        const clientId = await queueEntry("stock_logs", payload);
        queued.push({ ...payload, id: clientId, client_id: clientId, business_date: today });
      }
      if (hasNote) {
        const payload = { staff_id: staffId, event: "day_note" as const, tags: draft.tags, note: draft.note.trim() || null, recorded_at: recordedAt };
        const clientId = await queueEntry("stock_logs", payload);
        queued.push({ ...payload, id: clientId, client_id: clientId, product_id: null, product_name: null, unit: null, came_in: null, binned: null, on_hand: null, business_date: today });
      }
      for (const row of queued) appendToTodayCache(`cd-stock-logs:${site.id}`, row);
      void syncOutbox().catch(() => {});
      try {
        window.localStorage.removeItem(draftKey);
      } catch {}
      setDraftLoaded(null);
      setShowSaved(true);
      setTimeout(() => router.push("/stock"), 650);
    } catch (err) {
      setSaveError(`Could not save on this device: ${err instanceof Error ? err.message : "unknown error"}. Check the numbers, device time and available storage, then retry.`);
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full h-12 rounded-xl border bg-paper px-3 text-lg tabular-nums focus:outline-none focus:border-brand";
  const groups = [
    { title: "Counter / deli", rows: rows.filter((r) => r.line.category === "deli") },
    { title: "Sandwiches", rows: rows.filter((r) => r.line.category === "sandwich") },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Close count" backHref="/stock" />
      <SavedOverlay show={showSaved} message="Count saved" />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">Who&apos;s counting?</h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        {tracked.length === 0 && (
          <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
            Nothing is being tracked yet.{" "}
            {user?.role === "manager" ? (
              <Link href="/settings/stock" className="text-brand font-semibold underline">Pick the products and prices</Link>
            ) : (
              "A manager picks the products in Settings › Stock list & prices."
            )}
          </p>
        )}

        {tracked.length > 0 && (
          <div className="rounded-2xl bg-brand-soft border border-brand/20 px-4 py-3 text-sm text-ink space-y-1">
            <p><strong>Left now</strong> is what&apos;s in the shop right now: counter and back fridge. Skip anything you didn&apos;t count.</p>
            <p><strong>Came in</strong> and <strong>binned</strong> are since the last count.</p>
            {recentDeliveries.length > 0 && (
              <p>🚚 Deliveries since then: {recentDeliveries.map((d) => `${d.supplier_name} (${formatShortDay(localDateStr(new Date(d.recorded_at)))})`).join(", ")}</p>
            )}
          </div>
        )}

        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">{group.title}</h2>
            <div className="space-y-2.5">
              {group.rows.map(({ line, entered, invalid, sold }) => {
                const last = lastCounts.get(line.productId);
                const todays = countedToday.get(line.productId);
                const s = suggestions.get(line.productId);
                const unitLabel = line.unit === "kg" ? "kg" : "items";
                return (
                  <div key={line.productId} className={`rounded-2xl border px-4 py-3.5 ${invalid ? "bg-danger-soft border-danger/30" : entered ? "bg-surface border-brand/30" : "bg-surface border-line"}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-bold text-ink">{line.name}</p>
                      <p className="text-xs text-ink-soft text-right">
                        {last?.on_hand != null ? `Last: ${formatQty(last.on_hand, line.unit)} · ${formatShortDay(logDay(last))}` : "First count"}
                      </p>
                    </div>
                    {todays?.on_hand != null && (
                      <p className="text-xs text-gold-deep mt-0.5">Counted today: {formatQty(todays.on_hand, line.unit)} left. Saving again replaces it.</p>
                    )}
                    <div className="grid grid-cols-3 gap-2 mt-2.5">
                      {([["cameIn", "Came in"], ["binned", "Binned"], ["left", "Left now"]] as const).map(([field, label]) => (
                        <label key={field} className="block">
                          <span className={`block text-xs font-semibold mb-1 ${field === "left" ? "text-ink" : "text-ink-soft"}`}>{label} <span className="font-normal">({unitLabel})</span></span>
                          <input
                            type="text"
                            inputMode="decimal"
                            enterKeyHint="next"
                            value={valueOf(line, field)}
                            onChange={(e) => setValue(line, field, e.target.value)}
                            placeholder={field === "left" ? "–" : "0"}
                            aria-label={`${line.name}: ${label}`}
                            className={`${input} ${field === "left" ? "border-ink/30 font-semibold" : "border-line"}`}
                          />
                        </label>
                      ))}
                    </div>
                    {line.category === "sandwich" && (s?.cameIn || s?.binned) ? (
                      <p className="text-xs text-ink-soft mt-1.5">Filled in from the sandwich log: {s.cameIn ? `${s.cameIn} made` : ""}{s.cameIn && s.binned ? ", " : ""}{s.binned ? `${s.binned} binned` : ""}.</p>
                    ) : null}
                    {s?.batchesBinned ? (
                      <p className="text-xs text-gold-deep font-semibold mt-1.5">
                        {s.batchesBinned} counter batch{s.batchesBinned === 1 ? "" : "es"} binned since the last count. Put the weight in Binned.
                      </p>
                    ) : null}
                    {invalid && <p className="text-sm text-danger font-semibold mt-1.5">That doesn&apos;t look like a number.</p>}
                    {!invalid && entered && (
                      <p className={`text-sm font-semibold mt-1.5 ${sold != null && sold < 0 ? "text-danger" : "text-brand"}`}>
                        {sold == null
                          ? "First count — sales start from the next one."
                          : sold < 0
                            ? `⚠ ${formatQty(-sold, line.unit)} more than there should be. Missed a delivery in “Came in”?`
                            : `Sold ${formatQty(sold, line.unit)}${line.sell != null ? ` · about £${(sold * line.sell).toFixed(2)}` : ""}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {tracked.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">What was today like? (optional)</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(TAG_LABELS).map(([tag, label]) => {
                const on = draft.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((d) => ({ ...d, tags: on ? d.tags.filter((t) => t !== tag) : [...d.tags, tag] }))}
                    className={`h-11 rounded-full px-4 text-sm font-semibold transition-all active:scale-95 ${on ? "bg-ink text-paper shadow-sm" : "bg-surface text-ink border border-line"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <textarea
              maxLength={2000}
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              placeholder="e.g. market day, coach party at lunch, ran out of rolls…"
              className="w-full rounded-2xl border border-line bg-surface p-3.5 text-base min-h-20 placeholder:text-ink-faint focus:outline-none focus:border-brand"
            />
          </section>
        )}
      </div>

      <SaveBar
        disabled={!canSave}
        saving={saving}
        saved={false}
        onSave={handleSave}
        label={toSave.length ? `Save count (${toSave.length} of ${tracked.length})` : "Save"}
        hint={blocker}
      />
    </div>
  );
}
