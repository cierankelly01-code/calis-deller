"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { UnsyncedBadge } from "@/components/ui/UnsyncedBadge";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchActiveStaff, fetchActiveProducts } from "@/lib/data/queries";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

// UK guidance: cooked food should reach a core temperature of 75°C
// (or an equivalent time/temperature combination).
const COOK_TARGET_C = 75;

export default function CookingLogPage() {
  const router = useRouter();
  const { data: staff } = useCachedQuery("cd-staff", fetchActiveStaff);
  const { data: products } = useCachedQuery("cd-products", fetchActiveProducts);

  const [staffId, setStaffId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [temp, setTemp] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const numericTemp = temp === "" || temp === "-" ? null : parseFloat(temp);
  const inRange = numericTemp !== null ? numericTemp >= COOK_TARGET_C : null;
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
    try {
      await queueEntry("cooking_logs", {
        staff_id: staffId,
        product_id: productId,
        product_name: productName.trim(),
        quantity,
        temp_c: numericTemp,
        in_range: numericTemp >= COOK_TARGET_C,
        corrective_action: numericTemp < COOK_TARGET_C ? correctiveAction.trim() : null,
        recorded_at: new Date().toISOString(),
      });
      syncOutbox();
      setSaved(true);
      setTimeout(() => router.push("/"), 700);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Cooking Check" />
      <UnsyncedBadge />

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Who cooked it?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            What came out of the oven?
          </h2>
          {(products ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {(products ?? []).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => pickProduct(product.id, product.name)}
                  className={`h-12 rounded-xl px-4 text-base font-semibold transition-colors active:scale-95 ${
                    product.id === productId
                      ? "bg-teal-700 text-white"
                      : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
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
            className="w-full h-12 rounded-xl border border-zinc-300 px-3 text-base"
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            How many items?
          </h2>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-14 w-14 rounded-xl bg-white border border-zinc-200 shadow-sm text-2xl font-bold active:scale-95"
              aria-label="Fewer items"
            >
              −
            </button>
            <div className="h-14 w-24 flex items-center justify-center rounded-xl bg-zinc-900 text-white text-3xl font-mono tabular-nums">
              {quantity}
            </div>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(999, q + 1))}
              className="h-14 w-14 rounded-xl bg-white border border-zinc-200 shadow-sm text-2xl font-bold active:scale-95"
              aria-label="More items"
            >
              +
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Core temperature out of the oven
          </h2>
          <NumberPad value={temp} onChange={setTemp} suffix="°C" />
          {inRange === false && (
            <p className="mt-3 text-center text-red-600 font-medium">
              Below {COOK_TARGET_C}°C — keep cooking or record what you did
            </p>
          )}
          {inRange === true && (
            <p className="mt-3 text-center text-teal-700 font-medium">
              ✓ {COOK_TARGET_C}°C or above — safe to serve
            </p>
          )}
        </section>

        {needsCorrectiveAction && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
              Corrective action taken
            </h2>
            <textarea
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="e.g. returned to oven for 10 more minutes and re-probed..."
              className="w-full rounded-xl border border-zinc-300 p-3 text-base min-h-24"
            />
          </section>
        )}

        <button
          type="button"
          disabled={!canSave}
          onClick={handleSave}
          className="w-full h-14 rounded-xl bg-teal-700 text-white text-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
