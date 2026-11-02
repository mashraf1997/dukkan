'use strict';

// End-to-end: pay online → order confirmed → WhatsApp API messages;
// backups; white-label; secrets never leave the server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const H = { 'Content-Type': 'application/json', 'X-Dukkan': '1' };
const realFetch = globalThis.fetch;
const outbound = [];
let server, base, dir, cookie, store, app, latte;
let brand = { name: '', url: '', hideBranding: false };

const lastRef = () => Object.keys(store.db.payments.checkouts).pop();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    outbound.push({ to: 'stripe', body: String(opts.body || '') });
    if (u.includes('/v1/checkout/sessions/')) return new Response(JSON.stringify({ id: 'cs_1', payment_status: 'paid', amount_total: 1100, currency: 'egp', client_reference_id: lastRef(), payment_intent: 'pi_1' }), { status: 200 });
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
  }
  if (u.startsWith('https://graph.facebook.com/')) {
    outbound.push({ to: 'whatsapp', body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
  }
  return realFetch(url, opts);
};
const settle = () => new Promise((r) => setTimeout(r, 60));
async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await realFetch(base + url, { method, redirect: 'manual', headers: { ...H, ...(auth ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, `/api/admin${url}`, body, { auth: true });
const order = (name, phone) => call('POST', '/api/orders', { method: 'pickup', items: [{ id: latte.id, variant: 'Large', qty: 2 }], customer: { name, phone } });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dukkan-flow-'));
  app = createApp({ dataDir: dir, quiet: true, branding: () => brand });
  store = app.locals.store;
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/setup', { name: 'Test Café', whatsapp: '+20 100 123 4567', currency: 'EGP', lang: 'en', password: 'supersecret', sample: true, setupCode: app.locals.setupCode, timezone: 'Africa/Cairo' });
  cookie = r.headers.get('set-cookie').split(';')[0];
  latte = (await admin('GET', '/data')).json.products.find((p) => p.name === 'Latte');
});
after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('connections saved; secrets never returned or exported', async () => {
  assert.equal((await order('X', '0100')).json.payOnline, false);
  assert.equal((await admin('PUT', '/payments', { provider: 'stripe', currency: 'egp', stripeSecret: 'sk_test_abcdefghijkl', stripeWebhookSecret: 'whsec_abcdefghijkl' })).status, 200);
  assert.equal((await admin('PUT', '/whatsapp', { token: 'EAAtoken123', phoneNumberId: '1234567890', language: 'en', templates: { confirmed: { enabled: true }, ready: { enabled: true } } })).status, 200);
  const all = JSON.stringify([(await admin('GET', '/payments')).json, (await admin('GET', '/whatsapp')).json, (await admin('GET', '/data')).json, (await admin('GET', '/export')).json]);
  for (const secret of ['sk_test_abcdefghijkl', 'whsec_abcdefghijkl', 'EAAtoken123']) assert.ok(!all.includes(secret), secret);
});

test('pay online confirms the order and messages the customer once', async () => {
  const r = await order('Sara Ali', '01011112222');
  assert.equal(r.json.payOnline, true);
  assert.ok(r.json.token.length >= 16);
  assert.deepEqual((await call('GET', `/api/orders/${r.json.token}`)).json, { no: r.json.no, total: 11, status: 'new', paid: false });
  assert.equal((await call('GET', '/api/orders/short')).status, 404);
  const co = await call('POST', `/api/orders/${r.json.token}/checkout`, {});
  assert.equal(co.json.url, 'https://checkout.stripe.com/c/pay/cs_1');
  assert.match(outbound.find((x) => x.to === 'stripe').body, /unit_amount%5D=1100/);
  outbound.length = 0;
  const ret = await call('GET', `/pay/return?ref=${lastRef()}&p=stripe&session_id=cs_1`);
  assert.equal(ret.headers.get('location'), `/?order=${r.json.token}&paid=1`);
  await settle();
  const o = (await call('GET', `/api/orders/${r.json.token}`)).json;
  assert.equal(o.paid, true);
  assert.equal(o.status, 'confirmed');
  const m = outbound.filter((x) => x.to === 'whatsapp');
  assert.equal(m.length, 1);
  assert.equal(m[0].body.template.name, 'dukkan_confirmed');
  assert.equal(m[0].body.to, '201011112222');
  // Signed webhook for the same payment: nothing new.
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', client_reference_id: lastRef(), amount_total: 1100, currency: 'egp', id: 'cs_1' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_abcdefghijkl').update(`${t}.${body}`).digest('hex');
  assert.equal((await call('POST', '/webhooks/stripe', body, { headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } })).status, 200);
  await settle();
  assert.equal(outbound.filter((x) => x.to === 'whatsapp').length, 1);
  assert.equal((await call('POST', `/api/orders/${r.json.token}/checkout`, {})).status, 400);
  // Owner marks it done: "ready" goes out once.
  const id = store.orders.find((x) => x.token === r.json.token).id;
  assert.equal((await admin('PUT', `/orders/${id}`, { status: 'completed' })).json.autoSent, true);
  await admin('PUT', `/orders/${id}`, { status: 'new' });
  await admin('PUT', `/orders/${id}`, { status: 'completed' });
  await settle();
  assert.equal(outbound.filter((x) => x.body && x.body.template && x.body.template.name === 'dukkan_ready').length, 1);
});

test('backups and white-label', async () => {
  const r = await admin('POST', '/backups/now');
  const file = await admin('GET', `/backups/${r.json.date}`);
  assert.equal(file.json.app, 'dukkan');
  assert.ok(!file.text.includes('sk_test_abcdefghijkl'));
  assert.match((await call('GET', '/')).text, /github.com\/mashraf1997\/dukkan/);
  brand = { name: 'Pixel Agency', url: 'https://pixel.example', hideBranding: false };
  assert.match((await call('GET', '/')).text, /Pixel Agency/);
  assert.equal((await call('GET', '/api/state')).json.brand.name, 'Pixel Agency');
  brand = { name: '', url: '', hideBranding: true };
  assert.ok(!(await call('GET', '/')).text.includes('class="powered"'));
});
