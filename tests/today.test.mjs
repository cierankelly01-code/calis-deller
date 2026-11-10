import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

registerHooks({resolve(specifier,context,nextResolve) {
  return nextResolve(specifier.startsWith('@/')?pathToFileURL(resolve('src',specifier.slice(2)+'.ts')).href:specifier,context);
}});

const { localDayKey, isOnLocalDay, onlyOnDay } = await import('../src/lib/data/today.ts');
const { computeUnitSlotStatus } = await import('../src/lib/dashboard/dueStatus.ts');

const { allergensNotChecked, splitForAllergy } = await import('../src/lib/allergens/answer.ts');

test('the allergen screen never files an unchecked product as free of an allergen', () => {
  const blank = { name: 'New thing', allergens: [], may_contain: [], notes: null };
  const seeded = { name: 'Ham Salad', allergens: ['gluten'], may_contain: [], notes: 'Seeded sandwich — confirm the allergens' };
  const checked = { name: 'Cheddar', allergens: ['milk'], may_contain: [], notes: null };
  const mayNuts = { name: 'Flapjack', allergens: ['gluten'], may_contain: ['nuts'], notes: 'Made on site' };
  assert.equal(allergensNotChecked(blank), true);
  assert.equal(allergensNotChecked(seeded), true);
  assert.equal(allergensNotChecked(checked), false);

  const forEgg = splitForAllergy([blank, seeded, checked, mayNuts], 'egg');
  assert.deepEqual(forEgg.notRecorded.map((p) => p.name), ['Cheddar', 'Flapjack']);
  assert.deepEqual(forEgg.notChecked.map((p) => p.name), ['New thing', 'Ham Salad']);
  assert.deepEqual(forEgg.unsafe, []);

  // Listing the allergen always wins, checked or not, contains or may contain.
  assert.deepEqual(splitForAllergy([seeded, mayNuts], 'gluten').unsafe.map((p) => p.name), ['Ham Salad', 'Flapjack']);
  assert.deepEqual(splitForAllergy([mayNuts], 'nuts').unsafe.map((p) => p.name), ['Flapjack']);
});

test('every "today" list is read through useTodayRows, and in-memory ticks are keyed by day', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const files = (await readdir('src', { recursive: true })).filter((f) => /\.tsx?$/.test(f));
  for (const file of files) {
    const text = await readFile(resolve('src', file), 'utf8');
    assert.doesNotMatch(text, /useCachedQuery\(\s*`cd-today-/, `${file} reads a today cache without the day filter`);
  }
  const cleaning = await readFile('src/app/log/cleaning/page.tsx', 'utf8');
  assert.equal((cleaning.match(/\$\{day\}:\$\{session\}:\$\{taskId\}/g) ?? []).length, 2, 'cleaning ticks are read and written with the day');
  const fridge = await readFile('src/app/log/fridge/page.tsx', 'utf8');
  assert.match(fridge, /\$\{day\}:\$\{period\}:\$\{selectedUnit\.id\}/);
  assert.match(fridge, /d === day && p === period/);
});

// Local-time constructors, so the test means the same thing in any time zone.
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);
const unit = { id: 'u1', name: 'Walk-in', unit_type: 'fridge', target_min_c: 0, target_max_c: 5 };
const log = (when, period = 'am') => ({ id: 'l' + when.getTime(), unit_id: 'u1', period, reading_c: 3, in_range: true, recorded_at: when.toISOString() });

test("yesterday's fridge check never marks today's check as done", () => {
  const now = at(2026, 11, 10, 8);
  const [status] = computeUnitSlotStatus([unit], [log(at(2026, 11, 9, 8))], 'am', now);
  assert.equal(status.done, false);
  assert.equal(status.reading, null);
});

test("today's fridge check marks the slot as done", () => {
  const now = at(2026, 11, 10, 9);
  const [am] = computeUnitSlotStatus([unit], [log(at(2026, 11, 10, 8))], 'am', now);
  assert.equal(am.done, true);
  const [pm] = computeUnitSlotStatus([unit], [log(at(2026, 11, 10, 8))], 'pm', now);
  assert.equal(pm.done, false, 'a morning reading does not cover the afternoon');
});

test('a mixed cache keeps only rows from the local day', () => {
  const now = at(2026, 11, 10, 0, 5);
  const rows = [log(at(2026, 11, 10, 0, 1)), log(at(2026, 11, 9, 23, 59)), log(at(2025, 11, 10, 8))];
  const kept = onlyOnDay(rows, localDayKey(now));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].recorded_at, rows[0].recorded_at);
});

test('the day rolls over at local midnight, including the clock-change days', () => {
  assert.equal(isOnLocalDay(at(2026, 11, 9, 23, 59).toISOString(), localDayKey(at(2026, 11, 10, 0, 0))), false);
  assert.equal(isOnLocalDay(at(2026, 3, 29, 0, 30).toISOString(), localDayKey(at(2026, 3, 29, 23, 30))), true);
  assert.equal(isOnLocalDay(at(2026, 10, 25, 0, 30).toISOString(), localDayKey(at(2026, 10, 25, 23, 30))), true);
  assert.equal(isOnLocalDay('not a date', localDayKey(new Date())), false);
});
