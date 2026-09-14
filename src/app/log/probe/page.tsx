"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { SaveBar } from "@/components/ui/SaveBar";
import { SavedOverlay } from "@/components/ui/SavedOverlay";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { useSite } from "@/lib/site/SiteContext";
import { fetchActiveStaff } from "@/lib/data/queries";
import { useRememberedStaff } from "@/lib/staffMemory";
import { queueEntry } from "@/lib/offline/outbox";
import { syncOutbox } from "@/lib/offline/sync";

// Weekly probe accuracy check: iced water should read 0°C, boiling water
// 100°C, each within ±1°C. Outside that band the probe needs recalibrating
// or replacing before its readings can be trusted.

type Method = "ice" | "boiling";

const METHODS: Record<Method, { label: string; target: number }> = {
  ice: { label: "🧊 Iced water (0°C)", target: 0 },
  boiling: { label: "♨️ Boiling water (100°C)", target: 100 },
};

const TOLERANCE_C = 1;

export default function ProbeCalibrationPage() {
  const router = useRouter();
  const { site } = useSite();
  const { data: staff } = useCachedQuery(`cd-staff:${site.id}`, () => fetchActiveStaff(site.id));

  const { staffId, setStaffId } = useRememberedStaff(staff ?? []);
  const [method, setMethod] = useState<Method>("ice");
  const [reading, setReading] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  const numericReading = reading === "" || reading === "-" ? null : parseFloat(reading);
  const pass =
    numericReading !== null
      ? Math.abs(numericReading - METHODS[method].target) <= TOLERANCE_C
      : null;

  const canSave =
    staffId !== null &&
    numericReading !== null &&
    (pass !== false || correctiveAction.trim().length > 0) &&
    !saving;

  async function handleSave() {
    if (!canSave || numericReading === null || !staffId || pass === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await queueEntry("probe_calibration_logs", {
        staff_id: staffId,
        method,
        reading_c: numericReading,
        pass,
        corrective_action: !pass ? correctiveAction.trim() : null,
        recorded_at: new Date().toISOString(),
      });
      void syncOutbox().catch(() => {});
      setShowSaved(true);
      setTimeout(() => router.push("/"), 650);
    } catch {
      setSaveError("Could not save on this device. Check the fields, device time and available storage, then retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Probe Calibration" />
      <SavedOverlay show={showSaved} message="Calibration logged" />
      {saveError && <p role="alert" className="px-4 py-2 text-danger">{saveError}</p>}

      <div className="flex-1 px-4 py-5 space-y-7 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Who&apos;s checking the probe?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Method
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {(Object.keys(METHODS) as Method[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMethod(m);
                  setReading("");
                }}
                className={`h-16 rounded-2xl text-base font-semibold transition-all ${
                  method === m
                    ? "bg-brand text-white shadow-sm"
                    : "bg-surface text-ink border border-line shadow-sm"
                }`}
              >
                {METHODS[m].label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
            Probe reading
          </h2>
          <NumberPad value={reading} onChange={setReading} allowNegative suffix="°C" />
          {pass === true && (
            <p className="mt-3 text-center text-brand font-medium">
              ✓ Pass — within ±{TOLERANCE_C}°C of {METHODS[method].target}°C
            </p>
          )}
          {pass === false && (
            <p className="mt-3 text-center text-danger font-semibold" role="alert">
              Fail — more than ±{TOLERANCE_C}°C off {METHODS[method].target}°C
            </p>
          )}
        </section>

        {pass === false && (
          <section>
            <h2 className="text-[13px] font-semibold text-ink-soft uppercase tracking-wider mb-2.5">
              What did you do about it?
            </h2>
            <textarea maxLength={2000}
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="e.g. recalibrated probe, switched to backup probe..."
              className="w-full rounded-2xl border border-line bg-surface p-3.5 text-base min-h-24 placeholder:text-ink-faint focus:outline-none focus:border-brand"
            />
          </section>
        )}
      </div>

      <SaveBar disabled={!canSave} saving={saving} saved={false} onSave={handleSave} />
    </div>
  );
}
