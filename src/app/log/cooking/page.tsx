"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchActiveStaff, fetchActiveProducts } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

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
  const { data: staff } = useCachedQuery("cd-staff", fetchActiveStaff);
  const { data: products } = useCachedQuery("cd-products", fetchActiveProducts);

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [checkType, setCheckType] = useState<CheckType>("cooking");
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [temp, setTemp] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
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

  function pickProduct(id: string, name: string) {
    if (productId === id) {
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
      await queueEntry("cooking_logs", {
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
    } catch {
      setSaveError("Could not save on this device. Check the fields, device time and available storage, then retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Hot Food Check" />
      <SavedOverlay show={showSaved} message={`${productName.trim() || "Entry"} saved`} />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Who&apos;s checking?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
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
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Which product?
          </h2>
          {(products ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {(products ?? []).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => pickProduct(product.id, product.name)}
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
            onChange={(e) => {
              setProductName(e.target.value);
              setProductId(null);
            }}
            placeholder="…or type the product name"
            className="w-full h-12 rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-ink-faint focus:outline-none focus:border-brand"
          />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
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
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
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

        {needsCorrectiveAction && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
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

      <SaveBar disabled={!canSave} saving={saving} saved={false} onSave={handleSave} />
    </div>
  );
}
