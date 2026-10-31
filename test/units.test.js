'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isOpen, nextOpening, cleanSchedule, defaultSchedule } = require('../src/schedule');
const { parseCsv, productsFromCsv, productsToCsv, templateCsv } = require('../src/csv');
const { formatMoney } = require('../src/orders');

// 2024-01-08 is a Monday. Times are UTC and the schedule uses timezone "UTC".
const at = (iso) => new Date(`${iso}Z`);
const sched = (days, extra = {}) => ({ ...defaultSchedule(), enabled: true, timezone: 'UTC', days, ...extra });
const everyDay = (from, to, open = true) => Array.from({ length: 7 }, () => ({ open, from, to }));

test('schedule: disabled means always open', () => {
  assert.equal(isOpen(defaultSchedule(), at('2024-01-08T03:00:00')), true);
});

test('schedule: normal hours', () => {
  const s = sched(everyDay('09:00', '17:00'));
  assert.equal(isOpen(s, at('2024-01-08T08:59:00')), false);
  assert.equal(isOpen(s, at('2024-01-08T09:00:00')), true);
  assert.equal(isOpen(s, at('2024-01-08T16:59:00')), true);
  assert.equal(isOpen(s, at('2024-01-08T17:00:00')), false);
});

test('schedule: hours past midnight carry into the next day', () => {
  const days = everyDay('18:00', '02:00', false);
  days[1] = { open: true, from: '18:00', to: '02:00' }; // Monday only
  const s = sched(days);
  assert.equal(isOpen(s, at('2024-01-08T19:00:00')), true); // Mon 19:00
  assert.equal(isOpen(s, at('2024-01-09T01:30:00')), true); // Tue 01:30, from Monday's range
  assert.equal(isOpen(s, at('2024-01-09T02:30:00')), false);
  assert.equal(isOpen(s, at('2024-01-09T19:00:00')), false); // Tuesday is closed
});

test('schedule: closed days, all-day and time zones', () => {
  const days = everyDay('00:00', '00:00');
  days[0] = { open: false, from: '09:00', to: '17:00' }; // Sunday closed
  assert.equal(isOpen(sched(days), at('2024-01-07T12:00:00')), false);
  assert.equal(isOpen(sched(days), at('2024-01-08T03:00:00')), true);

  // 09:00–17:00 in Cairo (UTC+2 in January) is 07:00–15:00 UTC.
  const cairo = sched(everyDay('09:00', '17:00'), { timezone: 'Africa/Cairo' });
  assert.equal(isOpen(cairo, at('2024-01-08T07:30:00')), true);
  assert.equal(isOpen(cairo, at('2024-01-08T15:30:00')), false);
});

test('schedule: next opening', () => {
  const days = everyDay('09:00', '17:00');
  days[2] = { open: false, from: '09:00', to: '17:00' }; // Tuesday closed
  const s = sched(days);
  assert.deepEqual(nextOpening(s, at('2024-01-08T07:00:00')), { inDays: 0, from: '09:00' });
  assert.deepEqual(nextOpening(s, at('2024-01-08T18:00:00')), { inDays: 2, from: '09:00' }); // skips Tuesday
});

test('schedule: sanitizer rejects junk', () => {
  const s = cleanSchedule({ enabled: 'true', timezone: 'Not/AZone', days: [{ open: false, from: '25:00', to: 'x' }] });
  assert.equal(s.enabled, true);
  assert.equal(s.timezone, '');
  assert.equal(s.days.length, 7);
  assert.deepEqual(s.days[0], { open: false, from: '09:00', to: '23:00' });
});

test('csv: quotes, BOM, CRLF and semicolons', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('a;b\n1;2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n"multi\nline",2'), [['a', 'b'], ['multi\nline', '2']]);
});

test('csv: products import with sizes, booleans and localized text', () => {
  const csv = 'Category,Name,Price,Sizes,Available,Featured\nبيتزا,مارجريتا,,وسط:120 | كبير:160,نعم,yes\nDrinks,Cola,"1,5",,no,\n,,5,,,\n';
  const { products, errors } = productsFromCsv(csv);
  assert.equal(products.length, 2);
  assert.deepEqual(products[0].variants, [{ name: 'وسط', price: 120 }, { name: 'كبير', price: 160 }]);
  assert.equal(products[0].available, true);
  assert.equal(products[0].featured, true);
  assert.equal(products[1].price, 1.5);
  assert.equal(products[1].available, false);
  assert.deepEqual(errors, [{ line: 4, error: 'name_required' }]);
});

test('csv: export round-trips and template parses', () => {
  const cats = [{ id: 'c1', name: 'Pizza' }];
  const prods = [{ name: 'Margherita', categoryId: 'c1', price: 8, variants: [{ name: 'L', price: 11 }], available: true, featured: false }];
  const back = productsFromCsv(productsToCsv(prods, cats)).products;
  assert.equal(back[0].category, 'Pizza');
  assert.deepEqual(back[0].variants, [{ name: 'L', price: 11 }]);
  assert.equal(productsFromCsv(templateCsv()).products.length, 3);
});

test('money formatting', () => {
  assert.equal(formatMoney(3.5, '$'), '$3.50');
  assert.equal(formatMoney(35, 'EGP'), '35 EGP');
});

test('every locale has exactly the same keys as English', () => {
  const dir = path.join(__dirname, '..', 'locales');
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
  for (const file of fs.readdirSync(dir)) {
    const loc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(loc.meta && loc.meta.name && ['ltr', 'rtl'].includes(loc.meta.dir), `${file} meta`);
    for (const section of ['store', 'admin']) {
      assert.deepEqual(Object.keys(loc[section]).sort(), Object.keys(en[section]).sort(), `${file} ${section}`);
      for (const [k, v] of Object.entries(loc[section])) assert.ok(typeof v === 'string' && v.length, `${file} ${section}.${k}`);
    }
  }
});
