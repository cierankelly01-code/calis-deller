import type { ActiveFridgeUnit, TodayFridgeLog } from "@/lib/data/queries";
import { localDayKey, onlyOnDay } from "@/lib/data/today";

// "What's due right now" is the single highest-value dashboard element —
// it's what turns this from a form staff have to remember to open into
// something that visibly nags them when a check is overdue. Before 2pm the
// morning check is the live one; after that, the afternoon check.

export type DaySlot = "am" | "pm";

export function currentSlot(now: Date = new Date()): DaySlot {
  return now.getHours() < 14 ? "am" : "pm";
}

export type UnitSlotStatus = {
  unitId: string;
  unitName: string;
  done: boolean;
  reading: number | null; // latest reading for the slot, if any
  inRange: boolean | null;
};

export function computeUnitSlotStatus(
  units: ActiveFridgeUnit[],
  todayLogs: TodayFridgeLog[], // expected newest-first
  slot: DaySlot,
  now: Date = new Date()
): UnitSlotStatus[] {
  // The caller's list comes from a cache that can hold yesterday's rows; only
  // a reading taken today can mark today's check as done.
  const logs = onlyOnDay(todayLogs, localDayKey(now));
  return units.map((unit) => {
    // Legacy 'mid' entries count as the afternoon check.
    const latest =
      logs.find(
        (log) =>
          log.unit_id === unit.id && (slot === "am" ? log.period === "am" : log.period !== "am")
      ) ?? null;
    return {
      unitId: unit.id,
      unitName: unit.name,
      done: latest !== null,
      reading: latest?.reading_c ?? null,
      inRange: latest?.in_range ?? null,
    };
  });
}
