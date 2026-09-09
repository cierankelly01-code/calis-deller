export type AppRole = 'staff' | 'manager';
export const configTables = ['staff', 'fridge_units', 'suppliers', 'products', 'cleaning_tasks'];
export const logTables = ['fridge_temp_logs', 'cooking_logs', 'delivery_logs', 'cleaning_logs', 'probe_calibration_logs'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canAccess(role: unknown, table: string, method: string): boolean {
  if (role !== 'staff' && role !== 'manager') return false;
  if (![...configTables, ...logTables].includes(table)) return false;
  if (method === 'GET') return true;
  if (method === 'POST') return logTables.includes(table) || role === 'manager';
  return method === 'PATCH' && configTables.includes(table) && role === 'manager';
}

type Rule = (value: unknown) => boolean;
const text = (max: number, required = false): Rule => v => typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const oneOf = (...values: string[]): Rule => v => typeof v === 'string' && values.includes(v);
const number = (min: number, max: number): Rule => v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (min: number, max: number): Rule => v => number(min, max)(v) && Number.isInteger(v);
const boolean: Rule = v => typeof v === 'boolean';
const uuid: Rule = v => typeof v === 'string' && UUID.test(v);
const optional = (rule: Rule): Rule => v => v === null || rule(v);
const timestamp: Rule = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const allergens = ['celery','gluten','crustaceans','eggs','fish','lupin','milk','molluscs','mustard','peanuts','sesame','soya','sulphites','tree_nuts'];
const allergenList: Rule = v => Array.isArray(v) && v.length <= 14 && v.every(oneOf(...allergens)) && new Set(v).size === v.length;
const base = {name:text(200,true),active:boolean,sort_order:integer(0,100000)};
const log = {client_id:uuid,staff_id:uuid,recorded_at:timestamp,corrects_entry_id:optional(uuid),created_by_device:optional(text(200))};
const temp = number(-100,300);
const note = optional(text(2000));
const fields: Record<string, Record<string, Rule>> = {
  staff:base, suppliers:base,
  fridge_units:{...base,unit_type:oneOf('fridge','freezer'),target_min_c:temp,target_max_c:temp},
  products:{name:base.name,active:boolean,allergens:allergenList,may_contain:allergenList,notes:note,updated_at:timestamp},
  cleaning_tasks:{...base,session:oneOf('open','close','both')},
  fridge_temp_logs:{...log,unit_id:uuid,period:oneOf('am','mid','pm','other'),reading_c:temp,in_range:boolean,corrective_action:note},
  cooking_logs:{...log,check_type:oneOf('cooking','reheating','hot_hold'),product_id:optional(uuid),product_name:text(200,true),quantity:integer(1,10000),temp_c:temp,in_range:boolean,corrective_action:note},
  delivery_logs:{...log,supplier_id:optional(uuid),supplier_name:text(200,true),vehicle_temp_c:optional(temp),chilled_temp_c:optional(temp),frozen_temp_c:optional(temp),packaging_ok:boolean,in_date_ok:boolean,accepted:boolean,rejection_reason:note,notes:note},
  cleaning_logs:{...log,task_id:uuid,session:oneOf('open','close'),note},
  probe_calibration_logs:{...log,method:oneOf('ice','boiling'),reading_c:temp,pass:boolean,corrective_action:note},
};
const required: Record<string,string[]> = {
  staff:['name'],suppliers:['name'],products:['name'],
  fridge_units:['name','unit_type','target_min_c','target_max_c'],cleaning_tasks:['name','session'],
  fridge_temp_logs:['unit_id','period','reading_c','in_range'],
  cooking_logs:['product_name','temp_c','in_range'],delivery_logs:['supplier_name','accepted'],
  cleaning_logs:['task_id','session'],probe_calibration_logs:['method','reading_c','pass'],
};

export function validateWrite(table: string, method: string, input: unknown): Record<string,unknown> {
  if (!Object.hasOwn(fields,table) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid entry');
  const result: Record<string,unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (!Object.hasOwn(fields[table],key) || !fields[table][key](value)) throw new Error('Invalid entry');
    result[key] = value;
  }
  if (Object.keys(result).length === 0) throw new Error('Empty entry');
  if (method === 'POST') {
    const keys = [...required[table], ...(logTables.includes(table) ? ['client_id','staff_id','recorded_at'] : [])];
    if (keys.some(k => result[k] === undefined)) throw new Error('Incomplete entry');
  }
  if (table === 'fridge_units' && typeof result.target_min_c === 'number' && typeof result.target_max_c === 'number' && result.target_min_c >= result.target_max_c) throw new Error('Invalid temperature band');
  if (table === 'cooking_logs' && result.quantity === 0) throw new Error('Invalid quantity');
  if (result.recorded_at && Date.parse(String(result.recorded_at)) > Date.now() + 300000) throw new Error('Check device time');
  return result;
}

export function sameOrigin(headers: Headers, origin: string): boolean {
  return headers.get('origin') === origin && !['cross-site','none'].includes(headers.get('sec-fetch-site') ?? '');
}

// Per-process backstop for the single-container deployment. Database write
// limits are separate and shared; the edge must limit unauthenticated traffic.
export class RateLimiter {
  private entries = new Map<string,{count:number; until:number}>();
  private limit: number;
  private windowMs: number;
  constructor(limit: number, windowMs: number) { this.limit = limit; this.windowMs = windowMs; }
  allow(key: string, now = Date.now()): boolean {
    for (const [k,v] of this.entries) if (v.until <= now) this.entries.delete(k);
    const entry = this.entries.get(key);
    if (entry) { if (entry.count >= this.limit) return false; entry.count++; return true; }
    if (this.entries.size >= 10000) return false;
    this.entries.set(key,{count:1,until:now+this.windowMs});
    return true;
  }
}
