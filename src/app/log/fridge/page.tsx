"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff, fetchActiveFridgeUnits, fetchTodayFridgeLogs } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { appendToTodayCache } from "@/lib/data/optimistic";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

// "Round mode": a staff member walks the kitchen once, logging every unit
// in a row — after each save the next unchecked unit is selected
// automatically, and ticks show which are already done for this period.

type Period = "am" | "pm";

function defaultPeriod(): Period {
  return new Date().getHours() < 14 ? "am" : "pm";
}

export default function FridgeLogPage() {
  const router = useRouter();
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));
  const { data: units } = useCachedQuery(`cd-fridge-units:${site.id}`, () => fetchActiveFridgeUnits(site.id));
  const { data: todayLogs } = useCachedQuery(`cd-today-fridge-logs:${site.id}`, () => fetchTodayFridgeLogs(site.id));

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [unitChoice, setUnitChoice] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [reading, setReading] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  // Units saved from this device this visit — the server list refreshes on
  // its own schedule, so "done" is the union of both.
  const [doneNow, setDoneNow] = useState<Set<string>>(new Set());

  const doneForPeriod = useMemo(() => {
    const done = new Set<string>();
    for (const log of todayLogs ?? []) {
      // A 'mid' or 'pm' entry both count as the afternoon check.
      const logPeriod: Period = log.period === "am" ? "am" : "pm";
      if (logPeriod === period) done.add(log.unit_id);
    }
    for (const key of doneNow) {
      const [p, id] = key.split(":");
      if (p === period) done.add(id);
    }
    return done;
  }, [todayLogs, doneNow, period]);

  const remainingUnits = useMemo(
    () => (units ?? []).filter((u) => !doneForPeriod.has(u.id)),
    [units, doneForPeriod]
  );

  // Auto-select the first unchecked unit (derived, so no effect needed) —
  // the common path is: walk up, read the number pad straight away. An
  // explicit tap on any tile overrides it.
  const unitId = unitChoice ?? remainingUnits[0]?.id ?? null;

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
    selectedUnit !== null &&
    numericReading !== null &&
    (!needsCorrectiveAction || correctiveAction.trim().length > 0) &&
    !saving;

  async function handleSave() {
    if (!canSave || numericReading === null || !selectedUnit || !staffId) return;
    const rowInRange =
      numericReading >= selectedUnit.target_min_c && numericReading <= selectedUnit.target_max_c;
    setSaving(true);
    setSaveError(null);
    try {
      const recordedAt = new Date().toISOString();
      const clientId = await queueEntry("fridge_temp_logs", {
        staff_id: staffId,
        unit_id: selectedUnit.id,
        period,
        reading_c: numericReading,
        in_range: rowInRange,
        corrective_action: !rowInRange ? correctiveAction.trim() : null,
        recorded_at: recordedAt,
      });
      appendToTodayCache(`cd-today-fridge-logs:${site.id}`, {
        id: clientId,
        unit_id: selectedUnit.id,
        period,
        reading_c: numericReading,
        in_range: rowInRange,
        recorded_at: recordedAt,
      });
      void syncOutbox().catch(() => {});

      const moreToDo = remainingUnits.some((u) => u.id !== selectedUnit.id);
      setDoneNow((prev) => new Set(prev).add(`${period}:${selectedUnit.id}`));
      setShowSaved(true);
      setTimeout(() => {
        setShowSaved(false);
        setReading("");
        setCorrectiveAction("");
        // Back to auto-select: the derived unitId moves to the next
        // unchecked unit on its own.
        setUnitChoice(null);
        if (!moreToDo) router.push("/");
      }, 650);
    } catch (err) {
      setSaveError(`Could not save on this device: ${err instanceof Error ? err.message : "unknown error"}. Check the fields, device time and available storage, then retry.`);
    } finally {
      setSaving(false);
    }
  }

  const roundFinished = (units ?? []).length > 0 && remainingUnits.length === 0;

  // Why Save is greyed out, in the order staff hit the blockers.
  const blocker = !staffId
    ? (staff ?? []).length === 0 ? "No staff names set up yet — a manager adds them in Settings › Staff" : "Tap who's doing the round first"
    : !selectedUnit ? "Pick a unit"
    : numericReading === null ? "Enter the reading"
    : needsCorrectiveAction && correctiveAction.trim().length === 0 ? "Out of range — say what you did about it"
    : null;

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Fridge & Freezer Round" />
      <SavedOverlay show={showSaved} message={selectedUnit ? `${selectedUnit.name} saved` : "Saved"} />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Who&apos;s doing the round?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Which check?
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {(["am", "pm"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`py-3.5 rounded-2xl text-base font-semibold transition-all ${
                  period === p
                    ? "bg-brand text-white shadow-sm"
                    : "bg-surface text-ink border border-line shadow-sm"
                }`}
              >
                {p === "am" ? "🌅 Morning" : "🌤️ Afternoon"}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-2.5">
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider">
              Which unit?
            </h2>
            <span className="text-sm text-ink-soft">
              {doneForPeriod.size}/{(units ?? []).length} done
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {(units ?? []).map((unit) => {
              const done = doneForPeriod.has(unit.id);
              const selected = unit.id === unitId;
              return (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => {
                    setUnitChoice(unit.id);
                    setReading("");
                    setCorrectiveAction("");
                  }}
                  className={`relative h-20 rounded-2xl text-lg font-semibold px-3 transition-all active:scale-95 ${
                    selected
                      ? "bg-brand text-white shadow-sm"
                      : done
                        ? "bg-brand-soft text-ink border border-brand/20"
                        : "bg-surface text-ink border border-line shadow-sm"
                  }`}
                >
                  {unit.name}
                  <span className={`block text-xs font-normal ${selected ? "text-white/75" : "text-ink-soft"}`}>
                    {unit.target_min_c}° to {unit.target_max_c}°C
                  </span>
                  {done && (
                    <span
                      className={`absolute top-2 right-2 h-6 w-6 rounded-full grid place-items-center text-xs ${
                        selected ? "bg-white/25 text-white" : "bg-brand text-white"
                      }`}
                      aria-label="Already checked this period"
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {roundFinished && (
            <p className="mt-3 text-center text-brand font-semibold">
              ✓ Every unit checked for the {period === "am" ? "morning" : "afternoon"} — you can
              still re-log one if needed.
            </p>
          )}
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Reading{selectedUnit ? ` — ${selectedUnit.name}` : ""}
          </h2>
          <NumberPad value={reading} onChange={setReading} allowNegative suffix="°C" />
          {inRange === false && selectedUnit && (
            <p className="mt-3 text-center text-danger font-semibold" role="alert">
              Out of range — target is {selectedUnit.target_min_c}° to {selectedUnit.target_max_c}°C
            </p>
          )}
          {inRange === true && (
            <p className="mt-3 text-center text-brand font-medium">✓ In range</p>
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
              placeholder="e.g. moved stock to walk-in, called engineer, adjusted thermostat..."
              className="w-full rounded-2xl border border-line bg-surface p-3.5 text-base min-h-24 placeholder:text-ink-faint focus:outline-none focus:border-brand"
            />
          </section>
        )}
      </div>

      <SaveBar
        disabled={!canSave}
        saving={saving}
        saved={false}
        onSave={handleSave}
        hint={blocker}
        label={
          selectedUnit
            ? remainingUnits.filter((u) => u.id !== selectedUnit.id).length > 0
              ? `Save ${selectedUnit.name} & next unit`
              : `Save ${selectedUnit.name}`
            : "Save"
        }
      />
    </div>
  );
}
