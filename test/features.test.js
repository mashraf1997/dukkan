'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const H = { 'Content-Type': 'application/json', 'X-Dukkan': '1' };
let server;
let base;
let dir;
let cookie = '';

async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...H, ...headers, ...(auth ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html/csv */ }
  return { status: res.status, json, text, headers: res.headers };
}

const product = async (name) => (await call('GET', '/api/admin/data', undefined, { auth: true })).json.products.find((p) => p.name === name);
const customer = { name: 'A', phone: '1', address: 'Street 1' };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dukkan-feat-'));
  const app = createApp({ dataDir: dir, setupCode: 'MY-OWN-CODE', quiet: true });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/setup', { setupCode: 'my own code', name: 'Shop', whatsapp: '1555', currency: '$', lang: 'en', password: 'supersecret', sample: true });
  assert.equal(r.status, 200, 'SETUP_CODE env value is accepted');
  cookie = r.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('i18n endpoint serves admin strings for every language', async () => {
  for (const lang of ['ar', 'es', 'pt', 'fr', 'tr', 'id', 'hi']) {
    const r = await call('GET', `/api/i18n/${lang}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.strings.save && r.json.strings.save !== 'Save', `${lang} is translated`);
  }
  const unknown = await call('GET', '/api/i18n/xx');
  assert.equal(unknown.json.strings.save, 'Save');
});

test('storefront renders in every language with a language menu', async () => {
  const es = await call('GET', '/?lang=es');
  assert.match(es.text, /<html lang="es" dir="ltr">/);
  assert.match(es.text, /Buscar en el menú/);
  assert.match(es.text, /<select id="lang"/);
  assert.match(es.text, /hreflang="hi"/);
  const ar = await call('GET', '/?lang=ar');
  assert.match(ar.text, /dir="rtl"/);
});

test('discount codes: create, check, apply, count uses, limits', async () => {
  const c = await call('POST', '/api/admin/coupons', { code: 'welcome 10!', type: 'percent', value: 10, maxUses: 2 }, { auth: true });
  assert.equal(c.json.code, 'WELCOME10');
  const dup = await call('POST', '/api/admin/coupons', { code: 'WELCOME10', value: 5 }, { auth: true });
  assert.equal(dup.status, 409);

  const cookieItem = await product('Chocolate Chip Cookie'); // $2.50
  const items = [{ id: cookieItem.id, qty: 4 }]; // $10
  const check = await call('POST', '/api/coupon', { code: 'welcome10', items });
  assert.deepEqual(check.json, { code: 'WELCOME10', discount: 1 });
  assert.equal((await call('POST', '/api/coupon', { code: 'NOPE', items })).json.error, 'invalid_coupon');

  const o = await call('POST', '/api/orders', { method: 'pickup', items, customer, coupon: 'WELCOME10' });
  assert.equal(o.status, 200);
  assert.equal(o.json.total, 9);
  const msg = decodeURIComponent(o.json.whatsappUrl.split('text=')[1]);
  assert.match(msg, /Discount \(WELCOME10\): -\$1/);

  await call('POST', '/api/orders', { method: 'pickup', items, customer, coupon: 'WELCOME10' });
  const third = await call('POST', '/api/orders', { method: 'pickup', items, customer, coupon: 'WELCOME10' });
  assert.equal(third.json.error, 'invalid_coupon', 'maxUses reached');

  const fixed = await call('POST', '/api/admin/coupons', { code: 'BIG', type: 'fixed', value: 100, minOrder: 5 }, { auth: true });
  assert.equal((await call('POST', '/api/coupon', { code: 'BIG', items: [{ id: cookieItem.id, qty: 1 }] })).json.error, 'coupon_min_order');
  assert.equal((await call('POST', '/api/coupon', { code: 'BIG', items })).json.discount, 10, 'never more than the subtotal');

  await call('PUT', `/api/admin/coupons/${fixed.json.id}`, { active: false }, { auth: true });
  assert.equal((await call('POST', '/api/coupon', { code: 'BIG', items })).json.error, 'invalid_coupon');
  assert.equal((await call('DELETE', `/api/admin/coupons/${fixed.json.id}`, undefined, { auth: true })).status, 200);
});

test('delivery areas set the fee and are required for delivery', async () => {
  const r = await call('PUT', '/api/admin/settings', { zones: [{ name: 'Downtown', fee: 1 }, { name: 'Suburbs', fee: 4 }, { name: '', fee: 9 }] }, { auth: true });
  const zones = r.json.settings.zones;
  assert.equal(zones.length, 2);
  assert.ok(zones[0].id);

  const latte = await product('Spanish Latte'); // $5.50
  const items = [{ id: latte.id, qty: 1 }];
  const missing = await call('POST', '/api/orders', { method: 'delivery', items, customer });
  assert.equal(missing.json.error, 'zone_required');
  const ok = await call('POST', '/api/orders', { method: 'delivery', items, customer, zone: zones[1].id });
  assert.equal(ok.json.total, 9.5);
  assert.match(decodeURIComponent(ok.json.whatsappUrl), /Area: Suburbs/);

  const store = await call('GET', '/');
  assert.match(store.text, /"zones":\[\{"id":"[^"]+","name":"Downtown","fee":1\}/);
  await call('PUT', '/api/admin/settings', { zones: [] }, { auth: true });
});

test('opening hours close the shop automatically', async () => {
  const closedAllWeek = { enabled: true, timezone: 'UTC', days: Array.from({ length: 7 }, () => ({ open: false, from: '09:00', to: '17:00' })) };
  closedAllWeek.days[(new Date().getUTCDay() + 1) % 7] = { open: true, from: '10:00', to: '12:00' };
  const r = await call('PUT', '/api/admin/settings', { schedule: closedAllWeek }, { auth: true });
  assert.equal(r.json.open, false);

  const page = await call('GET', '/');
  assert.match(page.text, /Closed now · Opens \S+ 10:00/);
  const latte = await product('Spanish Latte');
  const o = await call('POST', '/api/orders', { method: 'pickup', items: [{ id: latte.id, qty: 1 }], customer });
  assert.equal(o.json.error, 'closed');

  const allDay = { enabled: true, timezone: 'UTC', days: Array.from({ length: 7 }, () => ({ open: true, from: '00:00', to: '00:00' })) };
  assert.equal((await call('PUT', '/api/admin/settings', { schedule: allDay }, { auth: true })).json.open, true);
  await call('PUT', '/api/admin/settings', { schedule: { enabled: false } }, { auth: true });
});

test('CSV import creates categories and products; export and template download', async () => {
  const csv = 'category,name,description,price,sizes,featured\nPizza,Margherita,Classic,,Medium:8 | Large:11,yes\nPizza,Funghi,,9,,\nNew Drinks,Iced Tea,,3,,\n';
  const r = await call('POST', '/api/admin/products/csv', { csv }, { auth: true });
  assert.equal(r.json.imported, 3);
  const data = (await call('GET', '/api/admin/data', undefined, { auth: true })).json;
  const pizza = data.categories.find((c) => c.name === 'Pizza');
  assert.ok(pizza);
  assert.equal(data.products.filter((p) => p.categoryId === pizza.id).length, 2);
  assert.ok(data.categories.find((c) => c.name === 'New Drinks'));

  const exp = await call('GET', '/api/admin/products.csv', undefined, { auth: true });
  assert.match(exp.headers.get('content-type'), /text\/csv/);
  assert.ok(exp.text.startsWith('category,name'));
  // Excel needs the UTF-8 BOM to show Arabic/Hindi correctly (fetch().text() strips it, so check bytes).
  const raw = Buffer.from(await (await fetch(`${base}/api/admin/products.csv`, { headers: { Cookie: cookie } })).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(exp.text, /Margherita/);
  assert.equal((await call('GET', '/api/admin/products-template.csv', undefined, { auth: true })).status, 200);
  assert.equal((await call('GET', '/api/admin/products.csv')).status, 401);

  const bad = await call('POST', '/api/admin/products/csv', { csv: 'foo,bar\n1,2' }, { auth: true });
  assert.equal(bad.status, 400);

  const replaced = await call('POST', '/api/admin/products/csv', { csv, replace: true }, { auth: true });
  assert.equal(replaced.json.imported, 3);
  assert.equal((await call('GET', '/api/admin/data', undefined, { auth: true })).json.products.length, 3);
});

test('visits are counted once per browser per day and skip bots', async () => {
  const before = (await call('GET', '/api/admin/stats', undefined, { auth: true })).json.visits.today;
  const first = await call('GET', '/', undefined, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const seen = first.headers.get('set-cookie').match(/dk_v=[^;]+/)[0];
  await call('GET', '/', undefined, { headers: { 'User-Agent': 'Mozilla/5.0', Cookie: seen } });
  await call('GET', '/', undefined, { headers: { 'User-Agent': 'WhatsApp/2.23 link preview' } });
  const after = (await call('GET', '/api/admin/stats', undefined, { auth: true })).json.visits;
  assert.equal(after.today, before + 1);
  assert.ok(after.conversion >= 0);
});

test('backups include discount codes', async () => {
  await call('POST', '/api/admin/coupons', { code: 'KEEPME', value: 5 }, { auth: true });
  const exp = await call('GET', '/api/admin/export', undefined, { auth: true });
  assert.ok(exp.json.coupons.some((c) => c.code === 'KEEPME'));
  await call('POST', '/api/admin/import', { ...exp.json, coupons: [] }, { auth: true });
  assert.equal((await call('GET', '/api/admin/data', undefined, { auth: true })).json.coupons.length, 0);
  await call('POST', '/api/admin/import', exp.json, { auth: true });
  assert.ok((await call('GET', '/api/admin/data', undefined, { auth: true })).json.coupons.some((c) => c.code === 'KEEPME'));
});

test('demo mode: seeded shop, known password, locked-down settings, resets', async () => {
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dukkan-demo-'));
  const app = createApp({ dataDir: demoDir, demo: { password: 'demo1234', resetMinutes: 60, lang: 'en' }, quiet: true });
  const srv = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const state = await (await fetch(`${b}/api/state`)).json();
    assert.deepEqual(state.demo, { password: 'demo1234', resetMinutes: 60 });
    assert.equal(state.setupDone, true);

    const page = await (await fetch(`${b}/`)).text();
    assert.match(page, /live demo/);

    const login = await fetch(`${b}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ password: 'demo1234' }) });
    const c = login.headers.get('set-cookie').split(';')[0];
    const stats = await (await fetch(`${b}/api/admin/stats`, { headers: { Cookie: c } })).json();
    assert.ok(stats.month.orders > 50, 'demo has order history');
    assert.ok(stats.visits.month > 0);

    const pw = await fetch(`${b}/api/admin/password`, { method: 'PUT', headers: { ...H, Cookie: c }, body: JSON.stringify({ current: 'demo1234', next: 'hijacked!!' }) });
    assert.equal(pw.status, 403);
    const imp = await fetch(`${b}/api/admin/import`, { method: 'POST', headers: { ...H, Cookie: c }, body: '{}' });
    assert.equal(imp.status, 403);

    // A visitor messes with the shop; a reset restores it.
    await fetch(`${b}/api/admin/settings`, { method: 'PUT', headers: { ...H, Cookie: c }, body: JSON.stringify({ name: 'Hacked' }) });
    require('../src/demo').resetDemo(app.locals.store, { password: 'demo1234', lang: 'en' });
    assert.equal(app.locals.store.settings.name, 'Bean & Bloom');
  } finally {
    srv.close();
    fs.rmSync(demoDir, { recursive: true, force: true });
  }
});

test('design: theme and font are validated and rendered', async () => {
  const ok = await call('PUT', '/api/admin/settings', { theme: 'elegant', font: 'serif' }, { auth: true });
  assert.equal(ok.json.settings.theme, 'elegant');
  assert.equal(ok.json.settings.font, 'serif');
  const page = await call('GET', '/');
  assert.match(page.text, /<body class="theme-elegant/);
  assert.match(page.text, /Playfair\+Display/);
  const bad = await call('PUT', '/api/admin/settings', { theme: '<script>', font: 'comic-sans' }, { auth: true });
  assert.equal(bad.json.settings.theme, 'fresh');
  assert.equal(bad.json.settings.font, 'cairo');
  const data = await call('GET', '/api/admin/data', undefined, { auth: true });
  assert.deepEqual(data.json.appearance.themes, ['fresh', 'grid', 'elegant', 'bold']);
  assert.ok(data.json.appearance.fonts.every((f) => f.href.startsWith('https://fonts.googleapis.com/')));
});

test('preview mode is noindex and does not count visits', async () => {
  const before = (await call('GET', '/api/admin/stats', undefined, { auth: true })).json.visits.today;
  const r = await call('GET', '/?preview=1', undefined, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  assert.match(r.text, /noindex/);
  assert.match(r.text, /"preview":true/);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal((await call('GET', '/api/admin/stats', undefined, { auth: true })).json.visits.today, before);
});

test('receipts print for logged-in owners only', async () => {
  const { json } = await call('GET', '/api/admin/orders', undefined, { auth: true });
  const id = json.orders[0].id;
  const anon = await call('GET', `/admin/receipt/${id}`);
  assert.equal(anon.status, 302);
  const r = await call('GET', `/admin/receipt/${id}`, undefined, { auth: true });
  assert.equal(r.status, 200);
  assert.match(r.text, new RegExp(`#${json.orders[0].no}`));
  assert.match(r.text, /size:80mm/);
  assert.equal((await call('GET', '/admin/receipt/nope', undefined, { auth: true })).status, 404);
});

test('stats include busiest hours, order methods and trends', async () => {
  const st = (await call('GET', '/api/admin/stats', undefined, { auth: true })).json;
  assert.equal(st.hours.length, 24);
  assert.ok(st.hours.reduce((a, b) => a + b, 0) >= 1);
  assert.deepEqual(Object.keys(st.methods).sort(), ['delivery', 'dineIn', 'pickup']);
  assert.ok('change' in st.month && 'change' in st.today);
});
