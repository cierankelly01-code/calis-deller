"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { supabase } from "@/lib/supabase/client";
import type {
  CleaningLogRow,
  CookingLogRow,
  DeliveryLogRow,
  FridgeTempLogRow,
  ProbeCalibrationLogRow,
} from "@/types/database";

// The inspection page: pick any date and see every record made that day,
// exactly what an EHO flicks through the paper diary for. Lookups include
// inactive staff/units/tasks so historic days still show correct names.

type DayData = {
  fridge: FridgeTempLogRow[];
  cooking: CookingLogRow[];
  deliveries: DeliveryLogRow[];
  cleaning: CleaningLogRow[];
  probe: ProbeCalibrationLogRow[];
  staffNames: Map<string, string>;
  unitNames: Map<string, string>;
  taskNames: Map<string, string>;
};

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

async function fetchDay(dateStr: string): Promise<DayData> {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const from = start.toISOString();
  const to = end.toISOString();

  const [fridge, cooking, deliveries, cleaning, probe, staff, units, tasks] = await Promise.all([
    supabase.from("fridge_temp_logs").select("*").gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("cooking_logs").select("*").gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("delivery_logs").select("*").gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("cleaning_logs").select("*").gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("probe_calibration_logs").select("*").gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("staff").select("id, name"),
    supabase.from("fridge_units").select("id, name"),
    supabase.from("cleaning_tasks").select("id, name"),
  ]);

  for (const result of [fridge, cooking, deliveries, cleaning, probe, staff, units, tasks]) {
    if (result.error) throw result.error;
  }

  const toMap = (rows: { id: string; name: string }[] | null) =>
    new Map((rows ?? []).map((r) => [r.id, r.name]));

  return {
    fridge: fridge.data ?? [],
    cooking: cooking.data ?? [],
    deliveries: deliveries.data ?? [],
    cleaning: cleaning.data ?? [],
    probe: probe.data ?? [],
    staffNames: toMap(staff.data),
    unitNames: toMap(units.data),
    taskNames: toMap(tasks.data),
  };
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">
        {title} <span className="text-zinc-400">({count})</span>
      </h2>
      {count === 0 ? <p className="text-sm text-zinc-400">No records.</p> : <div className="space-y-2">{children}</div>}
    </section>
  );
}

function Row({ children, flag }: { children: React.ReactNode; flag?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        flag ? "bg-red-50 border-red-200" : "bg-white border-zinc-200"
      }`}
    >
      {children}
    </div>
  );
}

export default function DiaryPage() {
  const [dateStr, setDateStr] = useState(() => toDateInputValue(new Date()));
  // Tagging the result with the date it was fetched for makes "loading"
  // derivable (result is stale ⇒ loading) — no setState in the effect body.
  const [result, setResult] = useState<{
    date: string;
    data: DayData | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDay(dateStr)
      .then((day) => {
        if (!cancelled) setResult({ date: dateStr, data: day, error: null });
      })
      .catch(() => {
        if (!cancelled)
          setResult({
            date: dateStr,
            data: null,
            error: "Couldn't load records — check the internet connection.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [dateStr]);

  const loading = result?.date !== dateStr;
  const data = loading ? null : result?.data ?? null;
  const error = loading ? null : result?.error ?? null;

  function shiftDay(delta: number) {
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDateStr(toDateInputValue(d));
  }

  const staffName = useCallback(
    (id: string) => data?.staffNames.get(id) ?? "Unknown",
    [data]
  );

  const prettyDate = useMemo(
    () =>
      new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [dateStr]
  );

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Diary" />
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-2xl w-full mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            className="h-12 w-12 rounded-xl bg-white border border-zinc-200 text-xl font-bold shrink-0"
            aria-label="Previous day"
          >
            ‹
          </button>
          <input
            type="date"
            value={dateStr}
            max={toDateInputValue(new Date())}
            onChange={(e) => e.target.value && setDateStr(e.target.value)}
            className="flex-1 h-12 rounded-xl border border-zinc-300 px-3 text-base text-center"
          />
          <button
            type="button"
            onClick={() => shiftDay(1)}
            className="h-12 w-12 rounded-xl bg-white border border-zinc-200 text-xl font-bold shrink-0"
            aria-label="Next day"
          >
            ›
          </button>
        </div>

        <p className="text-center font-semibold text-zinc-900">{prettyDate}</p>

        {loading && <p className="text-zinc-400 text-center">Loading…</p>}
        {error && <p className="text-red-600 font-medium text-center">{error}</p>}

        {!loading && !error && data && (
          <>
            <Section title="🧊 Fridge / freezer checks" count={data.fridge.length}>
              {data.fridge.map((log) => (
                <Row key={log.id} flag={!log.in_range}>
                  <span className="font-semibold">
                    {data.unitNames.get(log.unit_id) ?? "Unknown unit"}
                  </span>{" "}
                  — {log.reading_c}°C ({log.period.toUpperCase()}) ·{" "}
                  {log.in_range ? "in range" : "OUT OF RANGE"} · {formatTime(log.recorded_at)} ·{" "}
                  {staffName(log.staff_id)}
                  {log.corrective_action && (
                    <span className="block mt-1 text-red-700">Action: {log.corrective_action}</span>
                  )}
                </Row>
              ))}
            </Section>

            <Section title="🍳 Cooking checks" count={data.cooking.length}>
              {data.cooking.map((log) => (
                <Row key={log.id} flag={!log.in_range}>
                  <span className="font-semibold">{log.product_name}</span> × {log.quantity} —{" "}
                  {log.temp_c}°C · {log.in_range ? "≥75°C ✓" : "BELOW 75°C"} ·{" "}
                  {formatTime(log.recorded_at)} · {staffName(log.staff_id)}
                  {log.corrective_action && (
                    <span className="block mt-1 text-red-700">Action: {log.corrective_action}</span>
                  )}
                </Row>
              ))}
            </Section>

            <Section title="🚚 Deliveries" count={data.deliveries.length}>
              {data.deliveries.map((log) => (
                <Row key={log.id} flag={!log.accepted}>
                  <span className="font-semibold">{log.supplier_name}</span> —{" "}
                  {log.accepted ? "accepted" : "REJECTED"} · {formatTime(log.recorded_at)} ·{" "}
                  {staffName(log.staff_id)}
                  <span className="block text-zinc-500">
                    {[
                      log.vehicle_temp_c !== null ? `van ${log.vehicle_temp_c}°C` : null,
                      log.chilled_temp_c !== null ? `chilled ${log.chilled_temp_c}°C` : null,
                      log.frozen_temp_c !== null ? `frozen ${log.frozen_temp_c}°C` : null,
                      log.packaging_ok ? "packaging ok" : "packaging ISSUE",
                      log.in_date_ok ? "dates ok" : "date ISSUE",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {log.rejection_reason && (
                    <span className="block mt-1 text-red-700">Rejected: {log.rejection_reason}</span>
                  )}
                  {log.notes && <span className="block mt-1 text-zinc-500">{log.notes}</span>}
                </Row>
              ))}
            </Section>

            <Section title="🧽 Cleaning" count={data.cleaning.length}>
              {data.cleaning.map((log) => (
                <Row key={log.id}>
                  <span className="font-semibold">
                    {data.taskNames.get(log.task_id) ?? "Unknown task"}
                  </span>{" "}
                  — {log.session === "open" ? "opening" : "closing"} clean ·{" "}
                  {formatTime(log.recorded_at)} · {staffName(log.staff_id)}
                </Row>
              ))}
            </Section>

            <Section title="🌡️ Probe calibration" count={data.probe.length}>
              {data.probe.map((log) => (
                <Row key={log.id} flag={!log.pass}>
                  {log.method === "ice" ? "Iced water" : "Boiling water"} — {log.reading_c}°C ·{" "}
                  {log.pass ? "pass ✓" : "FAIL"} · {formatTime(log.recorded_at)} ·{" "}
                  {staffName(log.staff_id)}
                  {log.corrective_action && (
                    <span className="block mt-1 text-red-700">Action: {log.corrective_action}</span>
                  )}
                </Row>
              ))}
            </Section>

            <p className="text-xs text-zinc-400 text-center pb-4">
              Records are append-only — entries can&apos;t be edited or deleted after saving, so
              this page is inspection-ready evidence.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
