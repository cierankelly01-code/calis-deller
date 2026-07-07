"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffTilePicker } from "@/components/ui/StaffTilePicker";
import { NumberPad } from "@/components/ui/NumberPad";
import { UnsyncedBadge } from "@/components/ui/UnsyncedBadge";
import { useCachedQuery } from "@/lib/data/useCachedQuery";
import { fetchActiveStaff } from "@/lib/data/queries";
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
  const { data: staff } = useCachedQuery("cd-staff", fetchActiveStaff);

  const [staffId, setStaffId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("ice");
  const [reading, setReading] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
    try {
      await queueEntry("probe_calibration_logs", {
        staff_id: staffId,
        method,
        reading_c: numericReading,
        pass,
        corrective_action: !pass ? correctiveAction.trim() : null,
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
      <PageHeader title="Probe Calibration" />
      <UnsyncedBadge />

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 max-w-2xl w-full mx-auto">
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Who&apos;s checking the probe?
          </h2>
          <StaffTilePicker staff={staff ?? []} selectedId={staffId} onSelect={setStaffId} />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Method
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(METHODS) as Method[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMethod(m);
                  setReading("");
                }}
                className={`h-16 rounded-xl text-base font-semibold transition-colors ${
                  method === m
                    ? "bg-teal-700 text-white"
                    : "bg-white text-zinc-900 border border-zinc-200 shadow-sm"
                }`}
              >
                {METHODS[m].label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Probe reading
          </h2>
          <NumberPad value={reading} onChange={setReading} allowNegative suffix="°C" />
          {pass === true && (
            <p className="mt-3 text-center text-teal-700 font-medium">
              ✓ Pass — within ±{TOLERANCE_C}°C of {METHODS[method].target}°C
            </p>
          )}
          {pass === false && (
            <p className="mt-3 text-center text-red-600 font-medium">
              Fail — more than ±{TOLERANCE_C}°C off {METHODS[method].target}°C
            </p>
          )}
        </section>

        {pass === false && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
              What did you do about it?
            </h2>
            <textarea
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="e.g. recalibrated probe, switched to backup probe..."
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
