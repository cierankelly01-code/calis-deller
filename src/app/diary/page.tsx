"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { buildExportCsv, downloadCsv } from "@/lib/export/csv";
import { supabase } from "@/lib/supabase/client";
import { fetchDeliveryLabels } from "@/lib/data/queries";
import { useSite } from "@/lib/site/SiteContext";
import { REASONS, formatDay } from "@/lib/counter/board";
import { OUTCOMES } from "@/lib/ambient/board";
import type {
  AmbientDisplayLogRow,
  CleaningLogRow,
  CookingLogRow,
  CounterStockLogRow,
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
  counter: CounterStockLogRow[];
  ambient: AmbientDisplayLogRow[];
  deliveryLabels: Map<string, string>; // delivery id → "Supplier · date", for linked counter batches
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

async function fetchDay(siteId: string, dateStr: string): Promise<DayData> {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const from = start.toISOString();
  const to = end.toISOString();

  const [fridge, cooking, deliveries, cleaning, probe, counter, ambient, staff, units, tasks] = await Promise.all([
    supabase.from("fridge_temp_logs").select("*").eq("site_id", siteId).gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("cooking_logs").select("*").eq("site_id", siteId).gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("delivery_logs").select("*").eq("site_id", siteId).gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("cleaning_logs").select("*").eq("site_id", siteId).gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("probe_calibration_logs").select("*").eq("site_id", siteId).gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("counter_stock_logs").select("*").eq("site_id", siteId).gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("ambient_display_logs").select("*").eq("site_id", siteId).gte("recorded_at", from).lt("recorded_at", to).order("recorded_at"),
    supabase.from("staff").select("id, name").eq("site_id", siteId),
    supabase.from("fridge_units").select("id, name").eq("site_id", siteId),
    supabase.from("cleaning_tasks").select("id, name").eq("site_id", siteId),
  ]);

  for (const result of [fridge, cooking, deliveries, cleaning, probe, counter, ambient, staff, units, tasks]) {
    if (result.error) throw result.error;
  }

  const toMap = (rows: { id: string; name: string }[] | null) =>
    new Map((rows ?? []).map((r) => [r.id, r.name]));

  // Counter batches may point at deliveries from earlier days — look those up
  // by id so the diary can say which delivery a batch came in on.
  const deliveryLabels = await fetchDeliveryLabels(
    (counter.data ?? []).map((row) => row.delivery_log_id).filter((id): id is string => !!id)
  );

  return {
    fridge: fridge.data ?? [],
    cooking: cooking.data ?? [],
    deliveries: deliveries.data ?? [],
    cleaning: cleaning.data ?? [],
    probe: probe.data ?? [],
    counter: counter.data ?? [],
    ambient: ambient.data ?? [],
    deliveryLabels,
    staffNames: toMap(staff.data),
    unitNames: toMap(units.data),
    taskNames: toMap(tasks.data),
  };
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide mb-2">
        {title} <span className="text-ink-faint">({count})</span>
      </h2>
      {count === 0 ? <p className="text-sm text-ink-faint">No records.</p> : <div className="space-y-2">{children}</div>}
    </section>
  );
}

function Row({ children, flag }: { children: React.ReactNode; flag?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        flag ? "bg-danger-soft border-danger/30" : "bg-surface border-line"
      }`}
    >
      {children}
    </div>
  );
}

function ExportCard() {
  const { site } = useSite();
  const [fromStr, setFromStr] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInputValue(d);
  });
  const [toStr, setToStr] = useState(() => toDateInputValue(new Date()));
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function handleExport() {
    setState("working");
    try {
      const csv = await buildExportCsv(site.id, fromStr, toStr);
      downloadCsv(csv, `food-safety-diary_${site.slug}_${fromStr}_to_${toStr}.csv`);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="rounded-xl bg-surface border border-line p-4 space-y-3 print:hidden">
      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">
        📋 EHO export
      </h2>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={fromStr}
          max={toStr}
          onChange={(e) => e.target.value && setFromStr(e.target.value)}
          aria-label="Export from date"
          className="flex-1 min-w-0 h-12 rounded-xl border border-line px-2 text-sm text-center"
        />
        <span className="text-ink-faint shrink-0">to</span>
        <input
          type="date"
          value={toStr}
          min={fromStr}
          max={toDateInputValue(new Date())}
          onChange={(e) => e.target.value && setToStr(e.target.value)}
          aria-label="Export to date"
          className="flex-1 min-w-0 h-12 rounded-xl border border-line px-2 text-sm text-center"
        />
      </div>
      <button
        type="button"
        onClick={handleExport}
        disabled={state === "working"}
        className="w-full h-12 rounded-xl bg-brand text-paper font-bold active:scale-[0.99] disabled:opacity-60"
      >
        {state === "working" ? "Preparing…" : "Download CSV"}
      </button>
      {state === "error" && (
        <p className="text-sm text-danger font-medium">
          Export failed — check the internet connection and try again.
        </p>
      )}
      <p className="text-xs text-ink-faint">
        One spreadsheet row per record across every module, including device
        and server timestamps. For a PDF of a single day, use Print below.
      </p>
    </section>
  );
}

export default function DiaryPage() {
  const { site } = useSite();
  const [dateStr, setDateStr] = useState(() => toDateInputValue(new Date()));
  // Tagging the result with the date it was fetched for makes "loading"
  // derivable (result is stale ⇒ loading) — no setState in the effect body.
  const [result, setResult] = useState<{
    siteId: string;
    date: string;
    data: DayData | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDay(site.id, dateStr)
      .then((day) => {
        if (!cancelled) setResult({ siteId: site.id, date: dateStr, data: day, error: null });
      })
      .catch(() => {
        if (!cancelled)
          setResult({
            siteId: site.id,
            date: dateStr,
            data: null,
            error: "Couldn't load records — check the internet connection.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [site.id, dateStr]);

  const loading = result?.date !== dateStr || result?.siteId !== site.id;
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
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-2xl w-full mx-auto space-y-6 print:overflow-visible">
        {/* Print-only letterhead: browser Print → Save as PDF is the PDF export. */}
        <div className="hidden print:block text-center space-y-1">
          <p className="font-display text-2xl font-semibold">{site.name} — Food Safety Diary</p>
          <p className="text-sm">
            Records are append-only: entries cannot be edited or deleted after saving.
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => shiftDay(-1)}
            className="h-12 w-12 rounded-xl bg-surface border border-line text-xl font-bold shrink-0"
            aria-label="Previous day"
          >
            ‹
          </button>
          <input
            type="date"
            value={dateStr}
            max={toDateInputValue(new Date())}
            onChange={(e) => e.target.value && setDateStr(e.target.value)}
            className="flex-1 h-12 rounded-xl border border-line px-3 text-base text-center"
          />
          <button
            type="button"
            onClick={() => shiftDay(1)}
            className="h-12 w-12 rounded-xl bg-surface border border-line text-xl font-bold shrink-0"
            aria-label="Next day"
          >
            ›
          </button>
        </div>

        <p className="text-center font-semibold text-ink">{prettyDate}</p>

        {loading && <p className="text-ink-faint text-center">Loading…</p>}
        {error && <p className="text-danger font-medium text-center">{error}</p>}

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
                    <span className="block mt-1 text-danger">Action: {log.corrective_action}</span>
                  )}
                </Row>
              ))}
            </Section>

            <Section title="🍳 Hot food checks" count={data.cooking.length}>
              {data.cooking.map((log) => {
                const target = log.check_type === "hot_hold" ? 63 : 75;
                const typeLabel =
                  log.check_type === "hot_hold"
                    ? "hot hold"
                    : log.check_type === "reheating"
                      ? "reheating"
                      : "cooking";
                return (
                  <Row key={log.id} flag={!log.in_range}>
                    <span className="font-semibold">{log.product_name}</span> × {log.quantity} —{" "}
                    {log.temp_c}°C ({typeLabel}) ·{" "}
                    {log.in_range ? `≥${target}°C ✓` : `BELOW ${target}°C`} ·{" "}
                    {formatTime(log.recorded_at)} · {staffName(log.staff_id)}
                    {log.corrective_action && (
                      <span className="block mt-1 text-danger">Action: {log.corrective_action}</span>
                    )}
                  </Row>
                );
              })}
            </Section>

            <Section title="🚚 Deliveries" count={data.deliveries.length}>
              {data.deliveries.map((log) => (
                <Row key={log.id} flag={!log.accepted}>
                  <span className="font-semibold">{log.supplier_name}</span> —{" "}
                  {log.accepted ? "accepted" : "REJECTED"} · {formatTime(log.recorded_at)} ·{" "}
                  {staffName(log.staff_id)}
                  <span className="block text-ink-soft">
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
                    <span className="block mt-1 text-danger">Rejected: {log.rejection_reason}</span>
                  )}
                  {log.notes && <span className="block mt-1 text-ink-soft">{log.notes}</span>}
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

            <Section title="🥩 Counter stock rotation" count={data.counter.length}>
              {data.counter.map((log) => (
                <Row key={log.id} flag={log.reason === "end_of_life" || log.reason === "quality"}>
                  <span className="font-semibold">{log.product_name}</span> —{" "}
                  {log.event === "put_out"
                    ? `put out in ${data.unitNames.get(log.unit_id) ?? "serve-over"} · bin by ${log.discard_by ? formatDay(log.discard_by) : "?"} (${log.open_life_days} day open life${log.pack_use_by ? `, pack use-by ${formatDay(log.pack_use_by)}` : ""})`
                    : `taken off ${data.unitNames.get(log.unit_id) ?? "serve-over"} · ${log.reason ? REASONS[log.reason] : "no reason"}`}{" "}
                  · {formatTime(log.recorded_at)} · {staffName(log.staff_id)}
                  {(log.batch_code || log.delivery_log_id) && (
                    <span className="block text-ink-soft">
                      {[
                        log.batch_code ? `Batch ${log.batch_code}` : null,
                        log.delivery_log_id ? `From delivery: ${data.deliveryLabels.get(log.delivery_log_id) ?? "see delivery log"}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {log.note && <span className="block mt-1 text-ink-soft">{log.note}</span>}
                </Row>
              ))}
            </Section>

            <Section title="🥪 Sandwiches — 4-hour rule" count={data.ambient.length}>
              {data.ambient.map((log) => (
                <Row key={log.id} flag={log.outcome === "binned"}>
                  <span className="font-semibold">{log.quantity} × {log.product_name}</span> —{" "}
                  {log.event === "made"
                    ? "made and chilled"
                    : log.event === "put_out"
                      ? `put out on the counter · off by ${log.off_by ? formatTime(log.off_by) : "?"}`
                      : `taken off · ${log.outcome ? OUTCOMES[log.outcome] : ""}${log.outcome === "sold_out" ? "" : ` (${log.quantity} left)`}`}{" "}
                  · {formatTime(log.recorded_at)} · {staffName(log.staff_id)}
                  {log.note && <span className="block mt-1 text-ink-soft">{log.note}</span>}
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
                    <span className="block mt-1 text-danger">Action: {log.corrective_action}</span>
                  )}
                </Row>
              ))}
            </Section>

            <p className="text-xs text-ink-faint text-center print:hidden">
              Records are append-only — entries can&apos;t be edited or deleted after saving, so
              this page is inspection-ready evidence.
            </p>

            <button
              type="button"
              onClick={() => window.print()}
              className="w-full h-12 rounded-xl bg-surface border border-line font-bold text-ink active:scale-[0.99] print:hidden"
            >
              🖨️ Print / Save as PDF — {prettyDate}
            </button>

            <ExportCard />
            <div className="pb-4 print:hidden" />
          </>
        )}
      </div>
    </div>
  );
}
