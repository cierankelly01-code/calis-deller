import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWrite, canAccess, sameOrigin, RateLimiter } from '../src/lib/security/policy.ts';
import { escapeCell } from '../src/lib/export/csv-cell.ts';

test('spreadsheet exports neutralize formulas while preserving quotes and commas',()=>{
  assert.equal(escapeCell('=HYPERLINK("https://evil")'), '"\'=HYPERLINK(""https://evil"")"');
  assert.equal(escapeCell('  @SUM(1,2)'), '"\'  @SUM(1,2)"');
  assert.equal(escapeCell('Milk, "whole"'), '"Milk, ""whole"""');
});

test('only assigned staff and managers can read; settings writes need manager', () => {
  for (const role of [undefined, null, '', 'admin', 'authenticated']) assert.equal(canAccess(role, 'staff', 'GET'), false);
  assert.equal(canAccess('staff', 'staff', 'GET'), true);
  assert.equal(canAccess('staff', 'staff', 'POST'), false);
  assert.equal(canAccess('manager', 'products', 'PATCH'), true);
  assert.equal(canAccess('manager', 'cooking_logs', 'PATCH'), false);
  assert.equal(canAccess('manager', 'auth.users', 'GET'), false);
  assert.equal(canAccess('manager', 'staff', 'DELETE'), false);
});
test('writes reject unknown fields, invalid values and mass updates', () => {
  assert.throws(() => validateWrite('staff', 'POST', {name:'A', food_log_role:'manager'}));
  assert.throws(() => validateWrite('staff', 'POST', {name:' '.repeat(10)}));
  assert.throws(() => validateWrite('staff', 'POST', {name:'x'.repeat(201)}));
  assert.throws(() => validateWrite('staff', 'POST', [{name:'A'}]));
  assert.throws(() => validateWrite('staff', 'PATCH', {}));
  assert.deepEqual(validateWrite('staff', 'POST', {name:'  Pat  '}), {name:'Pat'});
  assert.throws(() => validateWrite('fridge_units', 'POST', {name:'A',unit_type:'fridge',target_min_c:8,target_max_c:1}));
  assert.throws(() => validateWrite('products','POST',{name:'A', allergens:['fake']}));
});
test('text remains plain data and legitimate punctuation is preserved', () => {
  assert.deepEqual(validateWrite('staff','POST',{name:'<script>alert(1)</script>'}),{name:'<script>alert(1)</script>'});
  assert.deepEqual(validateWrite('staff','POST',{name:"O’Connor & Sons"}),{name:"O’Connor & Sons"});
});
test('CSRF requires exact origin and rejects hostile fetch metadata', () => {
  assert.equal(sameOrigin(new Headers({origin:'https://food.example'}), 'https://food.example'),true);
  assert.equal(sameOrigin(new Headers({origin:'https://food.example.evil'}), 'https://food.example'),false);
  assert.equal(sameOrigin(new Headers(), 'https://food.example'),false);
  assert.equal(sameOrigin(new Headers({origin:'https://food.example','sec-fetch-site':'cross-site'}),'https://food.example'),false);
});
test('rate limiting stops excess requests and recovers after the window', () => {
  const limiter = new RateLimiter(2, 1000);
  assert.equal(limiter.allow('a',0),true);
  assert.equal(limiter.allow('a',1),true);
  assert.equal(limiter.allow('a',2),false);
  assert.equal(limiter.allow('b',2),true);
  assert.equal(limiter.allow('a',1001),true);
});
