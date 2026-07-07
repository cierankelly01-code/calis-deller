"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { UnsyncedBadge } from "@/components/ui/UnsyncedBadge";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchActiveStaff, fetchActiveSuppliers } from "@/lib/data/queries";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

// SFBB delivery check: probe chilled goods (accept ≤5°C, reject >8°C),
// frozen goods should be ≤ -18°C, packaging intact, dates in range.
// Temps are optional — not every delivery has all three categories.

type TempSlot = "vehicle" | "chilled" | "frozen";

const SLOT_LABELS: Record<TempSlot, string> = {
  vehicle: "Van",
  chilled: "Chilled food",
  frozen: "Frozen food",
};

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white border border-zinc-200 px-4 py-3">
      <p className="font-semibold text-zinc-900">{label}</p>
      <div className="flex gap-2">
        {([true, false] as const).map((option) => (
          <button
            key={String(option)}
            type="button"
            onClick={() => onChange(option)}
            className={`h-10 w-16 rounded-lg font-semibold transition-colors ${
              value === option
                ? option
                  ? "bg-teal-700 text-white"
                  : "bg-red-600 text-white"
                : "bg-zinc-100 text-zinc-500"
            }`}
          >
            {option ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DeliveryLogPage() {
  const router = useRouter();
  const { data: staff } = useCachedQuery("cd-staff", fetchActiveStaff);
  const { data: suppliers } = useCachedQuery("cd-suppliers", fetchActiveSuppliers);

  const [staffId, setStaffId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [temps, setTemps] = useState<Record<TempSlot, string>>({
    vehicle: "",
    chilled: "",
    frozen: "",
  });
  const [activeSlot, setActiveSlot] = useState<TempSlot>("chilled");
  const [packagingOk, setPackagingOk] = useState(true);
  const [inDateOk, setInDateOk] = useState(true);
  const [accepted, setAccepted] = useState(true);
  const [rejectionReason, setRejectionReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function parseTemp(value: string): number | null {
    return value === "" || value === "-" ? null : parseFloat(value);
  }

  const chilledTemp = parseTemp(temps.chilled);
  const frozenTemp = parseTemp(temps.frozen);
  const chilledWarning = chilledTemp !== null && chilledTemp > 8;
  const chilledCaution = chilledTemp !== null && chilledTemp > 5 && chilledTemp <= 8;
  const frozenWarning = frozenTemp !== null && frozenTemp > -18;

  const canSave =
    staffId !== null &&
    supplierName.trim().length > 0 &&
    (accepted || rejectionReason.trim().length > 0) &&
    !saving;

  function pickSupplier(id: string, name: string) {
    if (supplierId === id) {
      setSupplierId(null);
      setSupplierName("");
    } else {
      setSupplierId(id);
      setSupplierName(name);
    }
  }

  async function handleSave() {
    if (!canSave || !staffId) return;
    setSaving(true);
    try {
      await queueEntry("delivery_logs", {
        staff_id: staffId,
        supplier_id: supplierId,
        supplier_name: supplierName.trim(),
        vehicle_temp_c: parseTemp(temps.vehicle),
        chilled_temp_c: chilledTemp,
        frozen_temp_c: frozenTemp,
        packaging_ok: packagingOk,
        in_date_ok: inDateOk,
        accepted,
        rejection_reason: !accepted ? rejectionReason.trim() : null,
        notes: notes.trim() || null,
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
      <PageHeader title="Delivery Check" />
      <UnsyncedBadge />

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Who checked it in?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Supplier
          </h2>
          {(suppliers ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {(suppliers ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSupplier(s.id, s.name)}
                  className={`h-12 rounded-xl px-4 text-base font-semibold transition-colors active:scale-95 ${
                    s.id === supplierId
                      ? "bg-teal-700 text-white"
                      : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={supplierName}
            onChange={(e) => {
              setSupplierName(e.target.value);
              setSupplierId(null);
            }}
            placeholder="…or type the supplier name"
            className="w-full h-12 rounded-xl border border-zinc-300 px-3 text-base"
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Temperatures (fill in what applies)
          </h2>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {(Object.keys(SLOT_LABELS) as TempSlot[]).map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setActiveSlot(slot)}
                className={`h-16 rounded-xl text-sm font-semibold transition-colors ${
                  activeSlot === slot
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
                }`}
              >
                {SLOT_LABELS[slot]}
                <span className="block text-base font-mono">
                  {temps[slot] === "" ? "—" : `${temps[slot]}°C`}
                </span>
              </button>
            ))}
          </div>
          <NumberPad
            value={temps[activeSlot]}
            onChange={(v) => setTemps({ ...temps, [activeSlot]: v })}
            allowNegative
            suffix="°C"
          />
          {chilledCaution && (
            <p className="mt-3 text-center text-amber-600 font-medium">
              Chilled above 5°C — use quickly, note it below
            </p>
          )}
          {chilledWarning && (
            <p className="mt-3 text-center text-red-600 font-medium">
              Chilled above 8°C — should be rejected
            </p>
          )}
          {frozenWarning && (
            <p className="mt-3 text-center text-red-600 font-medium">
              Frozen warmer than −18°C — check for thawing
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Condition checks
          </h2>
          <ToggleRow label="Packaging intact & clean" value={packagingOk} onChange={setPackagingOk} />
          <ToggleRow label="Dates in range" value={inDateOk} onChange={setInDateOk} />
          <ToggleRow label="Delivery accepted" value={accepted} onChange={setAccepted} />
        </section>

        {!accepted && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
              Why was it rejected?
            </h2>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. chilled meat at 11°C, sent back with driver..."
              className="w-full rounded-xl border border-zinc-300 p-3 text-base min-h-24"
            />
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Notes (optional)
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. what was delivered, invoice number..."
            className="w-full rounded-xl border border-zinc-300 p-3 text-base min-h-20"
          />
        </section>

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
