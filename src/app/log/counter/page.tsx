"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import {
  fetchActiveStaff,
  fetchActiveProducts,
  fetchActiveFridgeUnits,
  fetchCounterStock,
  fetchRecentDeliveries,
} from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import {
  computeDiscardBy,
  formatDay,
  localDateStr,
  openBatches,
  describeDaysLeft,
  type CounterLog,
} from "@/lib/counter/board";

// "Put out": a new open batch has gone into a serve-over. The app works out
// the bin-by date (open life, or the pack's use-by if that's sooner) and, if
// the same product is already out, says so — new stock goes underneath and
// the older batch sells first. After saving the form resets but keeps the
// staff member and serve-over: morning set-up means putting out ten things
// in a row.

const UNIT_KEY = "cd-last-counter-unit";
const LIFE_OPTIONS = [1, 2, 3, 4, 5, 7];

function subscribeUnit() {
  return () => {};
}
function readStoredUnit(): string | null {
  try {
    return window.localStorage.getItem(UNIT_KEY);
  } catch {
    return null;
  }
}

export default function CounterPutOutPage() {
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: products } = useCachedQuery(`cd-products:${site.id}`, () => fetchActiveProducts(site.id));
  const { data: units } = useCachedQuery(`cd-fridge-units:${site.id}`, () => fetchActiveFridgeUnits(site.id));
  const { data: stockLogs } = useCachedQuery(`cd-counter-stock:${site.id}`, () => fetchCounterStock(site.id));
  const { data: deliveries } = useCachedQuery(`cd-recent-deliveries:${site.id}`, () => fetchRecentDeliveries(site.id));

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  // Remember the serve-over per device: each iPad tends to live by one
  // counter. useSyncExternalStore keeps SSR hydration clean (server renders
  // null, client repaints with the stored value straight after).
  const storedUnit = useSyncExternalStore(subscribeUnit, readStoredUnit, () => null);
  const [unitChoice, setUnitChoice] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [openLifeDays, setOpenLifeDays] = useState(3);
  const [packUseBy, setPackUseBy] = useState("");
  const [batchCode, setBatchCode] = useState("");
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  // Batches put out from this device this visit, so the "already out"
  // notice reflects them before the server list refreshes.
  const [addedNow, setAddedNow] = useState<CounterLog[]>([]);

  const serveOvers = useMemo(() => (units ?? []).filter((u) => u.unit_type === "fridge"), [units]);

  const candidateUnit = unitChoice ?? storedUnit;
  const unitId = serveOvers.some((u) => u.id === candidateUnit) ? candidateUnit : serveOvers[0]?.id ?? null;

  function pickUnit(id: string) {
    setUnitChoice(id);
    try {
      window.localStorage.setItem(UNIT_KEY, id);
    } catch {
      // Best-effort convenience only.
    }
  }

  function pickProduct(id: string, name: string, life: number) {
    if (productId === id) {
      setProductId(null);
      setProductName("");
      setOpenLifeDays(3);
    } else {
      setProductId(id);
      setProductName(name);
      setOpenLifeDays(life);
    }
  }

  const today = localDateStr(new Date());
  const packDateValid = packUseBy === "" || packUseBy >= today;
  const discardBy = computeDiscardBy(new Date(), openLifeDays, packUseBy || null);
  const packWins = packUseBy !== "" && packUseBy < computeDiscardBy(new Date(), openLifeDays, null);

  const alreadyOut = useMemo(() => {
    const key = productName.trim().toLowerCase();
    if (!key) return [];
    const byId = new Map<string, CounterLog>();
    for (const log of [...addedNow, ...(stockLogs ?? [])]) byId.set(log.client_id, log);
    return openBatches([...byId.values()], today).filter((b) => b.productName.trim().toLowerCase() === key);
  }, [stockLogs, productName, today, addedNow]);

  const canSave =
    staffId !== null && unitId !== null && productName.trim().length > 0 && packDateValid && !saving;

  const blocker = !staffId
    ? (staff ?? []).length === 0
      ? "No staff names set up yet — a manager adds them in Settings › Staff"
      : "Tap who's putting it out first"
    : serveOvers.length === 0
      ? "No fridges set up yet — a manager adds the serve-overs in Settings › Fridges"
      : productName.trim().length === 0
        ? "Pick or type the product"
        : !packDateValid
          ? "That pack is already past its use-by — don't put it out"
          : null;

  async function handleSave() {
    if (!canSave || !staffId || !unitId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const recordedAt = new Date();
      const payload = {
        staff_id: staffId,
        event: "put_out" as const,
        product_id: productId,
        product_name: productName.trim(),
        unit_id: unitId,
        open_life_days: openLifeDays,
        pack_use_by: packUseBy || null,
        batch_code: batchCode.trim() || null,
        delivery_log_id: deliveryId,
        recorded_at: recordedAt.toISOString(),
      };
      const clientId = await queueEntry("counter_stock_logs", payload);
      const row: CounterLog = {
        ...payload,
        id: clientId,
        client_id: clientId,
        batch_client_id: null,
        discard_by: computeDiscardBy(recordedAt, openLifeDays, packUseBy || null),
        reason: null,
        note: null,
      };
      appendToTodayCache(`cd-counter-stock:${site.id}`, row);
      setAddedNow((list) => [row, ...list]);
      void syncOutbox().catch(() => {});
      setShowSaved(true);
      setTimeout(() => {
        setShowSaved(false);
        // Keep staff + serve-over: the next tray is two taps away.
        setProductId(null);
        setProductName("");
        setOpenLifeDays(3);
        setPackUseBy("");
        setBatchCode("");
        setDeliveryId(null);
      }, 650);
    } catch (err) {
      setSaveError(
        `Could not save on this device: ${err instanceof Error ? err.message : "unknown error"}. Check the fields, device time and available storage, then retry.`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Put Out Stock" backHref="/counter" />
      <SavedOverlay show={showSaved} message={`${productName.trim() || "Batch"} on the counter`} />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Who&apos;s putting it out?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Which serve-over?
          </h2>
          {serveOvers.length === 0 ? (
            <p className="text-ink-soft rounded-2xl bg-surface border border-line p-4">
              No fridges set up yet —{" "}
              <Link href="/settings/units" className="text-brand font-semibold underline">
                add the serve-overs in Settings
              </Link>
              .
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {serveOvers.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => pickUnit(unit.id)}
                  className={`min-h-14 rounded-2xl px-3 text-base font-semibold transition-all active:scale-95 ${
                    unit.id === unitId
                      ? "bg-brand text-white shadow-sm"
                      : "bg-surface text-ink border border-line shadow-sm"
                  }`}
                >
                  🧊 {unit.name}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            What&apos;s going out?
          </h2>
          {(products ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {(products ?? []).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => pickProduct(product.id, product.name, product.open_life_days)}
                  className={`h-12 rounded-full px-4 text-base font-semibold transition-all active:scale-95 ${
                    product.id === productId
                      ? "bg-brand text-white shadow-sm"
                      : "bg-surface text-ink border border-line shadow-sm"
                  }`}
                >
                  {product.name}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={productName}
            maxLength={200}
            onChange={(e) => {
              setProductName(e.target.value);
              setProductId(null);
            }}
            placeholder="…or type the product name"
            className="w-full h-12 rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-ink-faint focus:outline-none focus:border-brand"
          />
        </section>

        {alreadyOut.length > 0 && (
          <div className="rounded-2xl bg-gold-soft border border-gold/50 px-4 py-3.5" role="status">
            <p className="font-bold text-gold-deep">
              ↧ {productName.trim()} is already out — this batch goes underneath
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              Sell the older one first:{" "}
              {alreadyOut
                .map((b) => `opened ${formatDay(localDateStr(new Date(b.openedAt)))}, bin by ${formatDay(b.discardBy)} (${describeDaysLeft(b.daysLeft).toLowerCase()})`)
                .join("; ")}
              .
            </p>
          </div>
        )}

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-1">
            Sell within how many days once open?
          </h2>
          <p className="text-sm text-ink-soft mb-2.5">Day it goes out counts as day 1. Set per product in the Allergen Guide.</p>
          <div className="grid grid-cols-6 gap-2">
            {LIFE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setOpenLifeDays(days)}
                className={`h-12 rounded-2xl text-base font-semibold transition-all active:scale-95 ${
                  days === openLifeDays
                    ? "bg-ink text-paper shadow-sm"
                    : "bg-surface text-ink border border-line shadow-sm"
                }`}
              >
                {days}
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2">
              Pack use-by (if it has one)
            </h2>
            <input
              type="date"
              value={packUseBy}
              min={today}
              onChange={(e) => setPackUseBy(e.target.value)}
              aria-label="Pack use-by date"
              className={`w-full h-12 rounded-2xl border bg-surface px-4 text-base focus:outline-none focus:border-brand ${
                packDateValid ? "border-line" : "border-danger"
              }`}
            />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2">
              Batch code (optional)
            </h2>
            <input
              type="text"
              value={batchCode}
              maxLength={200}
              onChange={(e) => setBatchCode(e.target.value)}
              placeholder="Off the box — for traceability"
              className="w-full h-12 rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-ink-faint focus:outline-none focus:border-brand"
            />
          </div>
        </section>

        {(deliveries ?? []).length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-1">
              Which delivery did it come in on? (optional)
            </h2>
            <p className="text-sm text-ink-soft mb-2.5">
              Links the batch to the supplier and the delivery check — traceability if anything is ever queried.
            </p>
            <div className="flex flex-wrap gap-2">
              {(deliveries ?? []).map((delivery) => (
                <button
                  key={delivery.id}
                  type="button"
                  onClick={() => setDeliveryId(deliveryId === delivery.id ? null : delivery.id)}
                  className={`h-11 rounded-full px-4 text-sm font-semibold transition-all active:scale-95 ${
                    delivery.id === deliveryId
                      ? "bg-ink text-paper shadow-sm"
                      : "bg-surface text-ink border border-line shadow-sm"
                  }`}
                >
                  🚚 {delivery.supplier_name} · {formatDay(localDateStr(new Date(delivery.recorded_at)))}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl bg-ink text-paper px-5 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.18em] text-paper/60 font-bold">Bin by</p>
          <p className="mt-1 text-2xl font-bold">{formatDay(discardBy)}</p>
          <p className="mt-1 text-sm text-paper/70">
            {packWins
              ? "The pack's use-by is sooner than the open life, so the pack date wins."
              : `${openLifeDays} day${openLifeDays === 1 ? "" : "s"} from today, today included. Tell customers: use within ${openLifeDays} day${openLifeDays === 1 ? "" : "s"}.`}
          </p>
        </section>
      </div>

      <SaveBar disabled={!canSave} saving={saving} saved={false} onSave={handleSave} label="Put it out" hint={blocker} />
    </div>
  );
}
