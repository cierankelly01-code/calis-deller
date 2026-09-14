// Hand-written to match supabase/migrations/ (0001 → 20260914 sites).
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
  site_id: string;
  name: string;
  allergens: string[];
  may_contain: string[];
  notes: string | null;
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
      products: TableDef<ProductRow, "name" | "site_id">;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
