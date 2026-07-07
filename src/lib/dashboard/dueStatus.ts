import type { ActiveFridgeUnit, TodayFridgeLog } from "@/lib/data/queries";

export type FridgeUnitStatus = {
  unitId: string;
  unitName: string;
  amDone: boolean;
  pmDone: boolean; // satisfied by a mid-shift OR evening check
  lastOutOfRange: boolean;
};

// "What's due today" is the single highest-value dashboard element — it's
// what turns this from a form staff have to remember to open into something
// that visibly nags them when a check is overdue.
export function computeFridgeUnitStatus(
  units: ActiveFridgeUnit[],
  todayLogs: TodayFridgeLog[]
): FridgeUnitStatus[] {
  return units.map((unit) => {
    const logsForUnit = todayLogs.filter((log) => log.unit_id === unit.id);
    return {
      unitId: unit.id,
      unitName: unit.name,
      amDone: logsForUnit.some((log) => log.period === "am"),
      pmDone: logsForUnit.some((log) => log.period === "mid" || log.period === "pm"),
      lastOutOfRange: logsForUnit.length > 0 && !logsForUnit[0].in_range,
    };
  });
}
