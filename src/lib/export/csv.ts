import { supabase } from "@/lib/supabase/client";
import { escapeCell } from './csv-cell';
import type {
  CleaningLogRow,
  CookingLogRow,
  DeliveryLogRow,
  FridgeTempLogRow,
  ProbeCalibrationLogRow,
} from "@/types/database";

// EHO export: every record in a date range, flattened into one
// spreadsheet-friendly table sorted chronologically. Columns are unified
// across modules so an inspector (or Excel filter) can slice by module,
// unit, staff or status. Both timestamps are included on purpose —
// recorded_at is device-set (when the check happened), synced_at is
// server-set (when it reached the database) — the gap between them is
// the back-filling detector that makes this diary trustworthy.

const HEADER = [
  "Date",
  "Time",
  "Module",
  "Item",
  "Reading",
  "Status",
  "Staff",
  "Notes / corrective action",
  "Recorded at (device)",
  "Synced at (server)",
];

type CsvRow = {
  recordedAt: string; // ISO, used for sorting
  syncedAt: string;
  module: string;
  item: string;
  reading: string;
  status: string;
  staffId: string;
  notes: string;
};

function localDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export async function buildExportCsv(fromDateStr: string, toDateStr: string): Promise<string> {
  const start = new Date(`${fromDateStr}T00:00:00`);
  const end = new Date(`${toDateStr}T00:00:00`);
  end.setDate(end.getDate() + 1); // inclusive of the "to" day
  const from = start.toISOString();
  const to = end.toISOString();

  // Name lookups include inactive rows so historic records still resolve.
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
  const staffNames = toMap(staff.data as { id: string; name: string }[] | null);
  const unitNames = toMap(units.data as { id: string; name: string }[] | null);
  const taskNames = toMap(tasks.data as { id: string; name: string }[] | null);

  const rows: CsvRow[] = [];

  for (const log of (fridge.data ?? []) as FridgeTempLogRow[]) {
    rows.push({
      recordedAt: log.recorded_at,
      syncedAt: log.synced_at,
      module: "Fridge/freezer check",
      item: unitNames.get(log.unit_id) ?? "Unknown unit",
      reading: `${log.reading_c}°C (${log.period.toUpperCase()})`,
      status: log.in_range ? "In range" : "OUT OF RANGE",
      staffId: log.staff_id,
      notes: log.corrective_action ?? "",
    });
  }

  for (const log of (cooking.data ?? []) as CookingLogRow[]) {
    const target = log.check_type === "hot_hold" ? 63 : 75;
    const typeLabel =
      log.check_type === "hot_hold" ? "hot hold" : log.check_type === "reheating" ? "reheating" : "cooking";
    rows.push({
      recordedAt: log.recorded_at,
      syncedAt: log.synced_at,
      module: "Hot food check",
      item: `${log.product_name} × ${log.quantity}`,
      reading: `${log.temp_c}°C (${typeLabel})`,
      status: log.in_range ? `Pass (≥${target}°C)` : `FAIL (below ${target}°C)`,
      staffId: log.staff_id,
      notes: log.corrective_action ?? "",
    });
  }

  for (const log of (deliveries.data ?? []) as DeliveryLogRow[]) {
    const temps = [
      log.vehicle_temp_c !== null ? `van ${log.vehicle_temp_c}°C` : null,
      log.chilled_temp_c !== null ? `chilled ${log.chilled_temp_c}°C` : null,
      log.frozen_temp_c !== null ? `frozen ${log.frozen_temp_c}°C` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const notes = [
      log.packaging_ok ? null : "Packaging issue",
      log.in_date_ok ? null : "Date issue",
      log.rejection_reason ? `Rejected: ${log.rejection_reason}` : null,
      log.notes,
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push({
      recordedAt: log.recorded_at,
      syncedAt: log.synced_at,
      module: "Delivery check",
      item: log.supplier_name,
      reading: temps,
      status: log.accepted ? "Accepted" : "REJECTED",
      staffId: log.staff_id,
      notes,
    });
  }

  for (const log of (cleaning.data ?? []) as CleaningLogRow[]) {
    rows.push({
      recordedAt: log.recorded_at,
      syncedAt: log.synced_at,
      module: "Cleaning",
      item: taskNames.get(log.task_id) ?? "Unknown task",
      reading: log.session === "open" ? "Opening clean" : "Closing clean",
      status: "Done",
      staffId: log.staff_id,
      notes: log.note ?? "",
    });
  }

  for (const log of (probe.data ?? []) as ProbeCalibrationLogRow[]) {
    rows.push({
      recordedAt: log.recorded_at,
      syncedAt: log.synced_at,
      module: "Probe calibration",
      item: log.method === "ice" ? "Iced water (0°C)" : "Boiling water (100°C)",
      reading: `${log.reading_c}°C`,
      status: log.pass ? "Pass" : "FAIL",
      staffId: log.staff_id,
      notes: log.corrective_action ?? "",
    });
  }

  rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  const lines = [HEADER.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        localDate(row.recordedAt),
        localTime(row.recordedAt),
        row.module,
        row.item,
        row.reading,
        row.status,
        staffNames.get(row.staffId) ?? "Unknown",
        row.notes,
        row.recordedAt,
        row.syncedAt,
      ]
        .map(escapeCell)
        .join(",")
    );
  }

  // UTF-8 BOM so Excel renders °C correctly instead of mojibake.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
