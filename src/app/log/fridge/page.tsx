"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { UnsyncedBadge } from "@/components/ui/UnsyncedBadge";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchActiveStaff, fetchActiveFridgeUnits } from "@/lib/data/queries";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

type Period = "am" | "mid" | "pm";

function defaultPeriod(): Period {
  const hour = new Date().getHours();
  if (hour < 11) return "am";
  if (hour < 16) return "mid";
  return "pm";
}

export default function FridgeLogPage() {
  const router = useRouter();
  const { data: staff } = useCachedQuery("cd-staff", fetchActiveStaff);
  const { data: units } = useCachedQuery("cd-fridge-units", fetchActiveFridgeUnits);

  const [staffId, setStaffId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [reading, setReading] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const selectedUnit = useMemo(
    () => units?.find((u) => u.id === unitId) ?? null,
    [units, unitId]
  );

  const numericReading = reading === "" || reading === "-" ? null : parseFloat(reading);
  const inRange =
    numericReading !== null && selectedUnit
      ? numericReading >= selectedUnit.target_min_c && numericReading <= selectedUnit.target_max_c
      : null;

  const needsCorrectiveAction = inRange === false;
  const canSave =
    staffId !== null &&
    unitId !== null &&
    numericReading !== null &&
    (!needsCorrectiveAction || correctiveAction.trim().length > 0) &&
    !saving;

  async function handleSave() {
    if (!canSave || numericReading === null || !selectedUnit || !staffId) return;
    const rowInRange =
      numericReading >= selectedUnit.target_min_c && numericReading <= selectedUnit.target_max_c;
    setSaving(true);
    try {
      await queueEntry("fridge_temp_logs", {
        staff_id: staffId,
        unit_id: selectedUnit.id,
        period,
        reading_c: numericReading,
        in_range: rowInRange,
        corrective_action: !rowInRange ? correctiveAction.trim() : null,
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
      <PageHeader title="Fridge / Freezer Check" />
      <UnsyncedBadge />

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Who&apos;s doing this check?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Which unit?
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(units ?? []).map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => {
                  setUnitId(unit.id);
                  setReading("");
                  setCorrectiveAction("");
                }}
                className={`h-20 rounded-xl text-lg font-semibold px-3 transition-colors active:scale-95 ${
                  unit.id === unitId
                    ? "bg-teal-700 text-white"
                    : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
                }`}
              >
                {unit.name}
                <span className="block text-xs font-normal opacity-80">
                  {unit.target_min_c}°C to {unit.target_max_c}°C
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Which check?
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {(["am", "mid", "pm"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`h-12 rounded-xl text-base font-semibold uppercase transition-colors ${
                  period === p
                    ? "bg-teal-700 text-white"
                    : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Reading
          </h2>
          <NumberPad value={reading} onChange={setReading} allowNegative suffix="°C" />
          {inRange === false && selectedUnit && (
            <p className="mt-3 text-center text-red-600 font-medium">
              Out of range (target {selectedUnit.target_min_c}°C–{selectedUnit.target_max_c}°C)
            </p>
          )}
          {inRange === true && (
            <p className="mt-3 text-center text-teal-700 font-medium">In range</p>
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
              placeholder="e.g. moved stock to walk-in, called engineer, adjusted thermostat..."
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
