"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { supabase } from "@/lib/supabase/client";
import type { FridgeUnitRow } from "@/types/database";

// Fridges default to the SFBB chilled band (1–5°C), freezers to −25…−18°C.
// The range is editable per unit for prep fridges / display units that run
// to a different spec.
const DEFAULTS = {
  fridge: { min: "1", max: "5" },
  freezer: { min: "-25", max: "-18" },
} as const;

type UnitType = "fridge" | "freezer";

export default function UnitsSettingsPage() {
  const [units, setUnits] = useState<FridgeUnitRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState<UnitType>("fridge");
  const [min, setMin] = useState<string>(DEFAULTS.fridge.min);
  const [max, setMax] = useState<string>(DEFAULTS.fridge.max);

  const fetchUnits = () =>
    supabase.from("fridge_units").select("*").eq("active", true).order("sort_order");

  function applyResult({ data, error: fetchError }: Awaited<ReturnType<typeof fetchUnits>>) {
    if (fetchError) {
      setError("Couldn't load — check the internet connection.");
      return;
    }
    setUnits(data ?? []);
    window.localStorage.removeItem("cd-fridge-units");
  }

  async function refresh() {
    applyResult(await fetchUnits());
  }

  useEffect(() => {
    fetchUnits().then(applyResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchType(type: UnitType) {
    setUnitType(type);
    setMin(DEFAULTS[type].min);
    setMax(DEFAULTS[type].max);
  }

  const numericMin = parseFloat(min);
  const numericMax = parseFloat(max);
  const canAdd =
    name.trim() !== "" &&
    !Number.isNaN(numericMin) &&
    !Number.isNaN(numericMax) &&
    numericMin < numericMax &&
    !busy;

  async function run(action: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setError(null);
    try {
      const { error: writeError } = await action();
      if (writeError) throw writeError;
      await refresh();
    } catch {
      setError("Couldn't save — check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function addUnit() {
    if (!canAdd) return;
    const nextSort = Math.max(0, ...(units ?? []).map((u) => u.sort_order)) + 1;
    run(() =>
      supabase.from("fridge_units").insert({
        name: name.trim(),
        unit_type: unitType,
        target_min_c: numericMin,
        target_max_c: numericMax,
        sort_order: nextSort,
      })
    );
    setName("");
  }

  function removeUnit(id: string) {
    run(() => supabase.from("fridge_units").update({ active: false }).eq("id", id));
  }

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Fridges & Freezers" backHref="/settings" />
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-2xl w-full mx-auto space-y-6">
        <p className="text-sm text-zinc-500">
          Each unit gets its own twice-daily temperature checks on the dashboard. Removing a unit
          hides it — its past readings are kept for inspection.
        </p>

        {error && <p className="text-red-600 font-medium">{error}</p>}
        {units === null && !error && <p className="text-zinc-400">Loading…</p>}

        <div className="space-y-2">
          {(units ?? []).map((unit) => (
            <div
              key={unit.id}
              className="flex items-center justify-between rounded-xl bg-white border border-zinc-200 px-4 py-3"
            >
              <div>
                <p className="font-semibold text-zinc-900">
                  {unit.unit_type === "freezer" ? "❄️" : "🧊"} {unit.name}
                </p>
                <p className="text-sm text-zinc-500">
                  Target {unit.target_min_c}°C to {unit.target_max_c}°C
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeUnit(unit.id)}
                className="text-sm font-semibold text-red-600 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <section className="rounded-xl bg-white border border-zinc-200 p-4 space-y-4">
          <h2 className="font-bold text-zinc-900">Add a unit</h2>

          <div className="grid grid-cols-2 gap-2">
            {(["fridge", "freezer"] as UnitType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => switchType(type)}
                className={`h-12 rounded-xl font-semibold capitalize transition-colors ${
                  unitType === type
                    ? "bg-teal-700 text-white"
                    : "bg-zinc-100 text-zinc-700"
                }`}
              >
                {type === "fridge" ? "🧊 Fridge" : "❄️ Freezer"}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={unitType === "fridge" ? "e.g. Prep Fridge" : "e.g. Chest Freezer"}
            className="w-full h-12 rounded-xl border border-zinc-300 px-3 text-base"
          />

          <div className="flex items-center gap-3">
            <label className="flex-1">
              <span className="block text-sm text-zinc-500 mb-1">Target min °C</span>
              <input
                type="number"
                step="0.5"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                className="w-full h-12 rounded-xl border border-zinc-300 px-3 text-base"
              />
            </label>
            <label className="flex-1">
              <span className="block text-sm text-zinc-500 mb-1">Target max °C</span>
              <input
                type="number"
                step="0.5"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                className="w-full h-12 rounded-xl border border-zinc-300 px-3 text-base"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!canAdd}
            onClick={addUnit}
            className="w-full h-12 rounded-xl bg-teal-700 text-white font-semibold disabled:opacity-40"
          >
            Add {unitType}
          </button>
        </section>
      </div>
    </div>
  );
}
