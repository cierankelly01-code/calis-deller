export function escapeCell(value:string):string {
  // CSV quoting alone does not stop Excel/Sheets executing formulas.
  const safe=/^\s*[=+\-@]|^[\t\r\n]/u.test(value)?`'${value}`:value;
  return `"${safe.replace(/"/g,'""')}"`;
}
