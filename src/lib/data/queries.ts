import { supabase } from "@/lib/supabase/client";
import type { CounterLog } from "@/lib/counter/board";

// Every fetcher is scoped to one site (shop). Callers pass the selected
// site's id from useSite(); cache keys are suffixed with it too.

export type Site = { id: string; slug: string; name: string; short_name: string };

export async function fetchSites(): Promise<Site[]> {
  const { data, error } = await supabase
    .from("sites")
    .select("id, slug, name, short_name")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export type ActiveStaff = { id: string; name: string };
export type ActiveFridgeUnit = {
  id: string;
  name: string;
  unit_type: "fridge" | "freezer";
  target_min_c: number;
  target_max_c: number;
};
export type TodayFridgeLog = {
  id: string;
  unit_id: string;
  period: "am" | "mid" | "pm" | "other";
  reading_c: number;
  in_range: boolean;
  recorded_at: string;
};

export async function fetchActiveStaff(siteId: string): Promise<ActiveStaff[]> {
  const { data, error } = await supabase
    .from("staff")
    .select("id, name")
    .eq("site_id", siteId)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function fetchActiveFridgeUnits(siteId: string): Promise<ActiveFridgeUnit[]> {
  const { data, error } = await supabase
    .from("fridge_units")
    .select("id, name, unit_type, target_min_c, target_max_c")
    .eq("site_id", siteId)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function fetchTodayFridgeLogs(siteId: string): Promise<TodayFridgeLog[]> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("fridge_temp_logs")
    .select("id, unit_id, period, reading_c, in_range, recorded_at")
    .eq("site_id", siteId)
    .gte("recorded_at", startOfDay.toISOString())
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// -- Products / allergens ---------------------------------------------------

export type ActiveProduct = {
  id: string;
  name: string;
  allergens: string[];
  may_contain: string[];
  notes: string | null;
  open_life_days: number;
};

export async function fetchActiveProducts(siteId: string): Promise<ActiveProduct[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, allergens, may_contain, notes, open_life_days")
    .eq("site_id", siteId)
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

// -- Suppliers ---------------------------------------------------------------

export type ActiveSupplier = { id: string; name: string };

export async function fetchActiveSuppliers(siteId: string): Promise<ActiveSupplier[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("site_id", siteId)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

// -- Cleaning ----------------------------------------------------------------

export type ActiveCleaningTask = {
  id: string;
  name: string;
  session: "open" | "close" | "both";
};

export async function fetchActiveCleaningTasks(siteId: string): Promise<ActiveCleaningTask[]> {
  const { data, error } = await supabase
    .from("cleaning_tasks")
    .select("id, name, session")
    .eq("site_id", siteId)
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export type TodayCleaningLog = {
  id: string;
  task_id: string;
  session: "open" | "close";
  recorded_at: string;
};

export async function fetchTodayCleaningLogs(siteId: string): Promise<TodayCleaningLog[]> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("cleaning_logs")
    .select("id, task_id, session, recorded_at")
    .eq("site_id", siteId)
    .gte("recorded_at", startOfDay.toISOString());
  if (error) throw error;
  return data ?? [];
}

// -- Counter stock ------------------------------------------------------------

// Everything from the last 60 days is enough to derive the board: an open
// batch older than that is long past any open life and shows as overdue.
export async function fetchCounterStock(siteId: string): Promise<CounterLog[]> {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const { data, error } = await supabase
    .from("counter_stock_logs")
    .select(
      "id, client_id, staff_id, event, batch_client_id, product_id, product_name, unit_id, open_life_days, pack_use_by, discard_by, batch_code, delivery_log_id, reason, note, recorded_at"
    )
    .eq("site_id", siteId)
    .gte("recorded_at", since.toISOString())
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Accepted deliveries from the last two weeks — the put-out screen offers
// them as "which delivery did this come in on?" for traceability.
export type RecentDelivery = { id: string; supplier_name: string; recorded_at: string };

export async function fetchRecentDeliveries(siteId: string): Promise<RecentDelivery[]> {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const { data, error } = await supabase
    .from("delivery_logs")
    .select("id, supplier_name, recorded_at")
    .eq("site_id", siteId)
    .eq("accepted", true)
    .gte("recorded_at", since.toISOString())
    .order("recorded_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

// Supplier + date for a set of delivery ids (counter batches link to the
// delivery they came in on). Fetched in small chunks: the API caps each
// query string, and a month's export can reference dozens of deliveries.
export async function fetchDeliveryLabels(ids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 20) {
    const { data, error } = await supabase
      .from("delivery_logs")
      .select("id, supplier_name, recorded_at")
      .in("id", unique.slice(i, i + 20));
    if (error) throw error;
    for (const row of data ?? []) {
      const day = new Date(row.recorded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      labels.set(row.id, `${row.supplier_name} · ${day}`);
    }
  }
  return labels;
}
