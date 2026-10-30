"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchActiveProducts, fetchRecentCooking } from "@/lib/data/queries";
import { cookedChoices } from "@/lib/cooking/choices";
import { useRememberedStaff } from "@/lib/staffMemory";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { HowLink } from "@/components/ui/HowLink";
import { computeDueBy } from "@/lib/cooling/board";

// Covers all three SFBB hot-food checks. After saving, the form resets but
// keeps the staff member and check type — morning bakes mean logging five
// trays in a row, so the screen stays put instead of bouncing home.

type CheckType = "cooking" | "reheating" | "hot_hold";

const CHECKS: Record<CheckType, { label: string; target: number; wording: string }> = {
  cooking: { label: "🍳 Cooking", target: 75, wording: "out of the oven" },
  reheating: { label: "♨️ Reheating", target: 75, wording: "after reheating" },
  hot_hold: { label: "🍲 Hot hold", target: 63, wording: "in hot holding" },
};

export default function CookingLogPage() {
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: products } = useCachedQuery("cd-products", fetchActiveProducts);
  const { data: recentCooking } = useCachedQuery(`cd-recent-cooking:${site.id}`, () => fetchRecentCooking(site.id));
  const choices = useMemo(() => cookedChoices(products ?? [], recentCooking ?? []), [products, recentCooking]);
  const [showAll, setShowAll] = useState(false);

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [checkType, setCheckType] = useState<CheckType>("cooking");
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [temp, setTemp] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  // Selling it warm off the side (sausage rolls)? The 2-hour cooling clock
  // starts the moment a cooked batch passes 75°C. On by default: switching
  // it off is the deliberate choice.
  const [startClock, setStartClock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const check = CHECKS[checkType];
  const numericTemp = temp === "" || temp === "-" ? null : parseFloat(temp);
  const inRange = numericTemp !== null ? numericTemp >= check.target : null;
  const needsCorrectiveAction = inRange === false;

  const canSave =
    staffId !== null &&
    productName.trim().length > 0 &&
    quantity > 0 &&
    numericTemp !== null &&
    (!needsCorrectiveAction || correctiveAction.trim().length > 0) &&
    !saving;

  const blocker = !staffId
    ? (staff ?? []).length === 0 ? "No staff names set up yet — a manager adds them in Settings › Staff" : "Tap who's checking first"
    : productName.trim().length === 0 ? "Pick or type the product"
    : numericTemp === null ? "Enter the core temperature"
    : needsCorrectiveAction && correctiveAction.trim().length === 0 ? "Below target — say what you did about it"
    : null;

  function pickProduct(id: string | null, name: string) {
    if (productName.trim().toLowerCase() === name.trim().toLowerCase()) {
      setProductId(null);
      setProductName("");
    } else {
      setProductId(id);
      setProductName(name);
    }
  }

  async function handleSave() {
    if (!canSave || numericTemp === null || !staffId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const cookingId = await queueEntry("cooking_logs", {
        staff_id: staffId,
        check_type: checkType,
        product_id: productId,
        product_name: productName.trim(),
        quantity,
        temp_c: numericTemp,
        in_range: numericTemp >= check.target,
        corrective_action: numericTemp < check.target ? correctiveAction.trim() : null,
        recorded_at: new Date().toISOString(),
      });
      const clock = checkType === "cooking" && startClock && numericTemp >= check.target;
      if (clock) {
        const recordedAt = new Date().toISOString();
        const out = { staff_id: staffId, event: "out", cooking_client_id: cookingId, product_id: productId, product_name: productName.trim(), quantity, recorded_at: recordedAt };
        const outId = await queueEntry("hot_batch_logs", out);
        appendToTodayCache(`cd-hot-batches:${site.id}`, { id: outId, client_id: outId, batch_client_id: null, temp_c: null, outcome: null, note: null, due_by: computeDueBy(new Date(recordedAt)), ...out });
      }
      void syncOutbox().catch(() => {});
      setShowSaved(true);
      setTimeout(() => {
        setShowSaved(false);
        // Keep staff + check type: the next tray is two taps away.
        setProductId(null);
        setProductName("");
        setQuantity(1);
        setTemp("");
        setCorrectiveAction("");
      }, 650);
    } catch (err) {
      setSaveError(`Could not save on this device: ${err instanceof Error ? err.message : "unknown error"}. Check the fields, device time and available storage, then retry.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Hot Food Check" />
      <SavedOverlay show={showSaved} message={`${productName.trim() || "Entry"} saved${checkType === "cooking" && startClock && inRange ? " · 2-hour clock started" : ""}`} />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <div className="flex flex-wrap gap-2"><HowLink method={checkType === "cooking" ? "cooking-safely" : checkType === "reheating" ? "reheating" : "hot-holding"} /></div>
        <section>
          <h2 className="section-title mb-2.5">
            Who&apos;s checking?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="section-title mb-2.5">
            What kind of check?
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {(Object.keys(CHECKS) as CheckType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setCheckType(type);
                  setTemp("");
                  setCorrectiveAction("");
                }}
                className={`py-3 rounded-2xl text-sm font-semibold transition-all ${
                  checkType === type
                    ? "bg-brand text-white shadow-sm"
                    : "bg-surface text-ink border border-line shadow-sm"
                }`}
              >
                {CHECKS[type].label}
                <span className={`block text-xs font-normal ${checkType === type ? "text-white/75" : "text-ink-soft"}`}>
                  {CHECKS[type].target}°C+
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title mb-2.5">
            Which product?
          </h2>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            {choices.map((choice) => {
              const on = productName.trim().toLowerCase() === choice.name.trim().toLowerCase();
              return (
                <button key={choice.name} type="button" onClick={() => pickProduct(choice.id, choice.name)} className={`h-16 rounded-2xl px-3 text-lg font-bold transition-all active:scale-95 ${on ? "bg-brand text-white shadow-sm" : "bg-surface text-ink border border-line shadow-sm"}`}>
                  {choice.name}
                </button>
              );
            })}
          </div>
          {!showAll ? (
            <button type="button" onClick={() => setShowAll(true)} className="min-h-11 text-sm font-semibold text-brand underline underline-offset-2">Something else?</button>
          ) : (
            <>
              {(products ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {(products ?? []).map((product) => (
                    <button key={product.id} type="button" onClick={() => pickProduct(product.id, product.name)} className={`h-11 rounded-full px-4 text-base font-semibold transition-all active:scale-95 ${product.id === productId ? "bg-brand text-white shadow-sm" : "bg-surface text-ink border border-line shadow-sm"}`}>
                      {product.name}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={productName}
                onChange={(e) => {
                  setProductName(e.target.value);
                  setProductId(null);
                }}
                placeholder="…or type what it is"
                className="w-full h-12 rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-ink-faint focus:outline-none focus:border-brand"
              />
            </>
          )}
        </section>

        <section>
          <h2 className="section-title mb-2.5">
            How many items?
          </h2>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-14 w-14 rounded-2xl bg-surface border border-line shadow-sm text-2xl font-bold text-ink active:scale-95"
              aria-label="Fewer items"
            >
              −
            </button>
            <div className="h-14 w-24 flex items-center justify-center rounded-2xl bg-ink text-paper text-3xl font-mono tabular-nums">
              {quantity}
            </div>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(999, q + 1))}
              className="h-14 w-14 rounded-2xl bg-surface border border-line shadow-sm text-2xl font-bold text-ink active:scale-95"
              aria-label="More items"
            >
              +
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-title mb-2.5">
            Core temperature {check.wording}
          </h2>
          <NumberPad value={temp} onChange={setTemp} suffix="°C" />
          {inRange === false && (
            <p className="mt-3 text-center text-danger font-semibold" role="alert">
              Below {check.target}°C —{" "}
              {checkType === "hot_hold"
                ? "reheat to 75°C or take it off sale"
                : "keep cooking, then re-probe"}
            </p>
          )}
          {inRange === true && (
            <p className="mt-3 text-center text-brand font-medium">
              ✓ {check.target}°C or above — safe
            </p>
          )}
        </section>

        {checkType === "cooking" && inRange !== false && (
          <section>
            <button type="button" role="switch" aria-checked={startClock} onClick={() => setStartClock((v) => !v)} className={`w-full flex items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3.5 text-left ${startClock ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}>
              <span>
                <span className="block font-bold text-ink">⏱ Start the 2-hour cooling clock</span>
                <span className="block text-sm text-ink-soft">For anything cooling on the side to sell warm. Off if it goes straight in the fridge.</span>
              </span>
              <span className={`h-8 w-14 shrink-0 rounded-full p-1 transition-colors ${startClock ? "bg-brand" : "bg-line"}`}><span className={`block h-6 w-6 rounded-full bg-white transition-transform ${startClock ? "translate-x-6" : ""}`} /></span>
            </button>
          </section>
        )}

        {needsCorrectiveAction && (
          <section>
            <h2 className="section-title mb-2.5">
              What did you do about it?
            </h2>
            <textarea maxLength={2000}
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="e.g. returned to oven for 10 more minutes and re-probed..."
              className="w-full rounded-2xl border border-line bg-surface p-3.5 text-base min-h-24 placeholder:text-ink-faint focus:outline-none focus:border-brand"
            />
          </section>
        )}
      </div>

      <SaveBar disabled={!canSave} saving={saving} saved={false} onSave={handleSave} hint={blocker} />
    </div>
  );
}
