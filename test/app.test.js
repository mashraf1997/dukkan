'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

let server;
let base;
let dir;
let cookie = '';

const H = { 'Content-Type': 'application/json', 'X-Dukkan': '1' };

async function call(method, url, body, { auth = false, headers = H } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...headers, ...(auth ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dukkan-test-'));
  const app = createApp({ dataDir: dir });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fresh install redirects storefront to setup', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/admin');
  const s = await call('GET', '/api/state');
  assert.deepEqual(s.json, { setupDone: false, authed: false, lang: 'ar' });
});

test('setup rejects weak passwords and missing CSRF header', async () => {
  assert.equal((await call('POST', '/api/setup', { password: 'short' })).status, 400);
  const noHeader = await call('POST', '/api/setup', { password: 'longenough' }, { headers: { 'Content-Type': 'application/json' } });
  assert.equal(noHeader.status, 403);
});

test('setup creates the shop with a sample menu and logs in', async () => {
  const r = await call('POST', '/api/setup', {
    name: 'Test Café', whatsapp: '+20 100 123 4567', currency: 'EGP', lang: 'en', password: 'supersecret', sample: true,
  });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^dk_session=/);

  const again = await call('POST', '/api/setup', { password: 'supersecret' });
  assert.equal(again.status, 409, 'setup can only run once');

  const data = await call('GET', '/api/admin/data', undefined, { auth: true });
  assert.equal(data.json.settings.name, 'Test Café');
  assert.equal(data.json.settings.whatsapp, '+201001234567');
  assert.ok(data.json.products.length > 5);
});

test('admin API requires a session', async () => {
  assert.equal((await call('GET', '/api/admin/data')).status, 401);
  assert.equal((await call('GET', '/api/admin/data', undefined, { auth: true })).status, 200);
});

test('login works and wrong passwords fail', async () => {
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'supersecret' })).status, 200);
});

test('storefront renders products and escapes HTML', async () => {
  await call('POST', '/api/admin/products', { name: '<script>alert(1)</script>', price: 5 }, { auth: true });
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /Test Café/);
  assert.match(r.text, /Spanish Latte/);
  assert.ok(!r.text.includes('<script>alert(1)</script>'));
  assert.ok(r.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('orders are priced server-side and produce a WhatsApp link', async () => {
  const { json } = await call('GET', '/api/admin/data', undefined, { auth: true });
  const latte = json.products.find((p) => p.name === 'Latte');
  const cookie_ = json.products.find((p) => p.name === 'Chocolate Chip Cookie');

  const r = await call('POST', '/api/orders', {
    method: 'pickup',
    items: [
      { id: latte.id, variant: 'Large', qty: 2, price: 0.01 },
      { id: cookie_.id, qty: 1 },
    ],
    customer: { name: 'Sara', phone: '0100' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 5.5 * 2 + 2.5);
  assert.equal(r.json.no, 1001);
  assert.match(r.json.whatsappUrl, /^https:\/\/wa\.me\/201001234567\?text=/);
  const text = decodeURIComponent(r.json.whatsappUrl.split('text=')[1]);
  assert.match(text, /New order #1001/);
  assert.match(text, /2× Latte \(Large\)/);
  assert.match(text, /Sara/);
});

test('orders validate variants, availability and required fields', async () => {
  const { json } = await call('GET', '/api/admin/data', undefined, { auth: true });
  const latte = json.products.find((p) => p.name === 'Latte');
  const cheesecake = json.products.find((p) => p.name === 'Cheesecake');
  const customer = { name: 'A', phone: '1', address: 'Street 1' };

  const bad = async (body) => (await call('POST', '/api/orders', body)).json.error;
  assert.equal(await bad({ method: 'pickup', items: [{ id: latte.id, qty: 1 }], customer }), 'invalid_variant');
  assert.equal(await bad({ method: 'pickup', items: [{ id: cheesecake.id, qty: 1 }], customer }), 'unavailable');
  assert.equal(await bad({ method: 'dineIn', items: [{ id: latte.id, variant: 'Large', qty: 1 }], customer }), 'invalid_method');
  assert.equal(await bad({ method: 'pickup', items: [{ id: latte.id, variant: 'Large', qty: 0 }], customer }), 'invalid_qty');
  assert.equal(await bad({ method: 'delivery', items: [{ id: latte.id, variant: 'Large', qty: 1 }], customer: { name: 'A', phone: '1' } }), 'address_required');
  assert.equal(await bad({ method: 'pickup', items: [], customer }), 'empty');
});

test('delivery fee, free delivery threshold and minimum order', async () => {
  await call('PUT', '/api/admin/settings', { deliveryFee: 2, freeDeliveryOver: 10, minOrder: 3 }, { auth: true });
  const { json } = await call('GET', '/api/admin/data', undefined, { auth: true });
  const cookie_ = json.products.find((p) => p.name === 'Chocolate Chip Cookie');
  const customer = { name: 'A', phone: '1', address: 'Street 1' };

  const below = await call('POST', '/api/orders', { method: 'delivery', items: [{ id: cookie_.id, qty: 1 }], customer });
  assert.equal(below.json.error, 'below_minimum');

  const paid = await call('POST', '/api/orders', { method: 'delivery', items: [{ id: cookie_.id, qty: 2 }], customer });
  assert.equal(paid.json.total, 5 + 2);

  const free = await call('POST', '/api/orders', { method: 'delivery', items: [{ id: cookie_.id, qty: 4 }], customer });
  assert.equal(free.json.total, 10);
});

test('closed shop refuses orders', async () => {
  await call('PUT', '/api/admin/settings', { acceptingOrders: false }, { auth: true });
  const { json } = await call('GET', '/api/admin/data', undefined, { auth: true });
  const r = await call('POST', '/api/orders', { method: 'pickup', items: [{ id: json.products[0].id, qty: 1 }], customer: { name: 'A', phone: '1' } });
  assert.equal(r.json.error, 'closed');
  await call('PUT', '/api/admin/settings', { acceptingOrders: true }, { auth: true });
});

test('order status updates and stats', async () => {
  const list = await call('GET', '/api/admin/orders', undefined, { auth: true });
  assert.ok(list.json.orders.length >= 3);
  const id = list.json.orders[0].id;
  const upd = await call('PUT', `/api/admin/orders/${id}`, { status: 'completed' }, { auth: true });
  assert.equal(upd.json.status, 'completed');
  assert.equal((await call('PUT', `/api/admin/orders/${id}`, { status: 'bogus' }, { auth: true })).status, 400);

  const stats = await call('GET', '/api/admin/stats', undefined, { auth: true });
  assert.ok(stats.json.today.orders >= 3);
  assert.equal(stats.json.days.length, 14);
});

test('settings are sanitized', async () => {
  const r = await call('PUT', '/api/admin/settings', { color: 'red;}body{display:none', logo: 'javascript:alert(1)', lang: 'xx', deliveryFee: -5 }, { auth: true });
  assert.equal(r.json.settings.color, '#0f766e');
  assert.equal(r.json.settings.logo, '');
  assert.equal(r.json.settings.lang, 'en');
  assert.equal(r.json.settings.deliveryFee, 0);
});

test('image upload accepts images only', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const ok = await call('POST', '/api/admin/upload', { dataUrl: png }, { auth: true });
  assert.match(ok.json.url, /^\/uploads\/[\w-]+\.png$/);
  const img = await fetch(base + ok.json.url);
  assert.equal(img.status, 200);
  const bad = await call('POST', '/api/admin/upload', { dataUrl: 'data:text/html;base64,PGgxPg==' }, { auth: true });
  assert.equal(bad.status, 400);
});

test('export / import round-trip', async () => {
  const exp = await call('GET', '/api/admin/export', undefined, { auth: true });
  assert.equal(exp.json.app, 'dukkan');
  const n = exp.json.products.length;
  await call('DELETE', `/api/admin/products/${exp.json.products[0].id}`, undefined, { auth: true });
  const imp = await call('POST', '/api/admin/import', exp.json, { auth: true });
  assert.equal(imp.status, 200);
  const data = await call('GET', '/api/admin/data', undefined, { auth: true });
  assert.equal(data.json.products.length, n);
});

test('changing the password signs out old sessions', async () => {
  const old = cookie;
  const r = await call('PUT', '/api/admin/password', { current: 'supersecret', next: 'evenmoresecret' }, { auth: true });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/admin/data', undefined, { auth: true })).status, 200);
  const stale = await fetch(`${base}/api/admin/data`, { headers: { Cookie: old } });
  assert.equal(stale.status, 401);
});

test('data persists across restarts', () => {
  const app2 = createApp({ dataDir: dir });
  const store = app2.locals.store;
  assert.equal(store.settings.name, 'Test Café');
  assert.ok(store.orders.length >= 3);
});
