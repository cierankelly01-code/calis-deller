// Hand-written to match supabase/migrations/ (0001 → 20260916 counter stock).
// Once a live Supabase project exists, regenerate with:
//   npx supabase gen types typescript --project-id <id> > src/types/database.ts
// and re-apply this file's structure/comments if the generator overwrites them.

export type SiteRow = {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type StaffRow = {
  id: string;
  site_id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type FridgeUnitRow = {
  id: string;
  site_id: string;
  name: string;
  unit_type: "fridge" | "freezer";
  target_min_c: number;
  target_max_c: number;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type FridgeTempLogRow = {
  id: string;
  site_id: string;
  client_id: string;
  staff_id: string;
  unit_id: string;
  period: "am" | "mid" | "pm" | "other";
  reading_c: number;
  in_range: boolean;
  corrective_action: string | null;
  recorded_at: string;
  synced_at: string;
  corrects_entry_id: string | null;
  created_by_device: string | null;
};

export type SupplierRow = {
  id: string;
  site_id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type ProductRow = {
  id: string;
  site_id: string | null; // always null: the product list is shared by both shops
  name: string;
  allergens: string[];
  may_contain: string[];
  notes: string | null;
  open_life_days: number; // sell within N days of opening, day opened = day 1
  category: "deli" | "sandwich"; // sandwiches go out at room temperature (4-hour rule)
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CookingLogRow = {
  id: string;
  site_id: string;
  client_id: string;
  staff_id: string;
  check_type: "cooking" | "reheating" | "hot_hold";
  product_id: string | null;
  product_name: string;
  quantity: number;
  temp_c: number;
  in_range: boolean;
  corrective_action: string | null;
  recorded_at: string;
  synced_at: string;
  corrects_entry_id: string | null;
  created_by_device: string | null;
};

export type DeliveryLogRow = {
  id: string;
  site_id: string;
  client_id: string;
  staff_id: string;
  supplier_id: string | null;
  supplier_name: string;
  vehicle_temp_c: number | null;
  chilled_temp_c: number | null;
  frozen_temp_c: number | null;
  packaging_ok: boolean;
  in_date_ok: boolean;
  accepted: boolean;
  rejection_reason: string | null;
  notes: string | null;
  recorded_at: string;
  synced_at: string;
  corrects_entry_id: string | null;
  created_by_device: string | null;
};

export type CleaningTaskRow = {
  id: string;
  site_id: string;
  name: string;
  session: "open" | "close" | "both";
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type CleaningLogRow = {
  id: string;
  site_id: string;
  client_id: string;
  staff_id: string;
  task_id: string;
  session: "open" | "close";
  note: string | null;
  recorded_at: string;
  synced_at: string;
  corrects_entry_id: string | null;
  created_by_device: string | null;
};

export type ProbeCalibrationLogRow = {
  id: string;
  site_id: string;
  client_id: string;
  staff_id: string;
  method: "ice" | "boiling";
  reading_c: number;
  pass: boolean;
  corrective_action: string | null;
  recorded_at: string;
  synced_at: string;
  corrects_entry_id: string | null;
  created_by_device: string | null;
};

export type CounterStockLogRow = {
  id: string;
  site_id: string;
  client_id: string;
  staff_id: string;
  event: "put_out" | "taken_off";
  batch_client_id: string | null; // taken_off → the put_out row's client_id
  product_id: string | null;
  product_name: string;
  unit_id: string; // the serve-over it was displayed in
  open_life_days: number | null;
  pack_use_by: string | null; // YYYY-MM-DD
  discard_by: string | null; // YYYY-MM-DD, server-derived
  batch_code: string | null;
  delivery_log_id: string | null; // traceability: the delivery it came in on
  reason: "sold_out" | "end_of_life" | "quality" | "other" | null;
  note: string | null;
  recorded_at: string;
  synced_at: string;
  corrects_entry_id: string | null;
  created_by_device: string | null;
};

export type AmbientDisplayLogRow = {
  id: string;
  site_id: string;
  client_id: string;
  staff_id: string;
  event: "made" | "put_out" | "taken_off";
  batch_client_id: string | null; // taken_off → the put_out row's client_id
  product_id: string | null;
  product_name: string;
  quantity: number; // made/put_out: how many; taken_off: how many were left
  display_minutes: number | null; // put_out: the shop's window (default 180), never over 240
  off_by: string | null; // put_out: server-derived, recorded_at + display_minutes
  outcome: "sold_out" | "chilled" | "binned" | null;
  note: string | null;
  recorded_at: string;
  synced_at: string;
  corrects_entry_id: string | null;
  created_by_device: string | null;
};

// supabase-js v2 requires each table to carry a Relationships array and the
// schema to declare Views/Functions — without them the schema fails its
// GenericSchema constraint and every Insert/Update degrades to `never`.
type TableDef<Row, RequiredInsertKeys extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, RequiredInsertKeys>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      sites: TableDef<SiteRow, "slug" | "name" | "short_name">;
      staff: TableDef<StaffRow, "name" | "site_id">;
      fridge_units: TableDef<FridgeUnitRow, "name" | "unit_type" | "target_min_c" | "target_max_c" | "site_id">;
      fridge_temp_logs: TableDef<
        FridgeTempLogRow,
        "client_id" | "staff_id" | "unit_id" | "period" | "reading_c" | "in_range" | "recorded_at"
      >;
      suppliers: TableDef<SupplierRow, "name" | "site_id">;
      products: TableDef<ProductRow, "name">;
      cooking_logs: TableDef<
        CookingLogRow,
        "client_id" | "staff_id" | "product_name" | "quantity" | "temp_c" | "in_range" | "recorded_at"
      >;
      delivery_logs: TableDef<
        DeliveryLogRow,
        "client_id" | "staff_id" | "supplier_name" | "accepted" | "recorded_at"
      >;
      cleaning_tasks: TableDef<CleaningTaskRow, "name" | "session" | "site_id">;
      cleaning_logs: TableDef<
        CleaningLogRow,
        "client_id" | "staff_id" | "task_id" | "session" | "recorded_at"
      >;
      probe_calibration_logs: TableDef<
        ProbeCalibrationLogRow,
        "client_id" | "staff_id" | "method" | "reading_c" | "pass" | "recorded_at"
      >;
      counter_stock_logs: TableDef<
        CounterStockLogRow,
        "client_id" | "staff_id" | "event" | "product_name" | "unit_id" | "recorded_at"
      >;
      ambient_display_logs: TableDef<
        AmbientDisplayLogRow,
        "client_id" | "staff_id" | "event" | "product_name" | "quantity" | "recorded_at"
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
