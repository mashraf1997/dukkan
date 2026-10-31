'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');

const { Store, DEFAULT_SETTINGS } = require('./store');
const auth = require('./auth');
const { LANGS } = require('./i18n');
const { loadSample } = require('./sample');
const { buildOrder, whatsappMessage, whatsappUrl, STATUSES } = require('./orders');
const { renderStore, renderQrPrint, renderManifest } = require('./views');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// ---------- input sanitizers ----------
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const bool = (v) => v === true || v === 'true' || v === 1 || v === 'on';
const imageUrl = (v) => {
  const s = str(v, 500);
  return /^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/i.test(s) ? s : '';
};

const SETTINGS_SCHEMA = {
  name: (v) => str(v, 80) || 'My Shop',
  tagline: (v) => str(v, 140),
  about: (v) => str(v, 1000),
  logo: imageUrl,
  cover: imageUrl,
  whatsapp: (v) => str(v, 30).replace(/[^\d+]/g, ''),
  currency: (v) => str(v, 12),
  lang: (v) => (LANGS.includes(v) ? v : 'en'),
  color: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : DEFAULT_SETTINGS.color),
  acceptingOrders: bool,
  closedMessage: (v) => str(v, 200),
  delivery: bool,
  deliveryFee: num,
  freeDeliveryOver: num,
  minOrder: num,
  pickup: bool,
  dineIn: bool,
  address: (v) => str(v, 200),
  hours: (v) => str(v, 120),
  phone: (v) => str(v, 30),
  instagram: (v) => str(v, 200),
  facebook: (v) => str(v, 200),
  tiktok: (v) => str(v, 200),
  mapUrl: (v) => (/^https?:\/\//i.test(str(v, 500)) ? str(v, 500) : ''),
};

function cleanSettings(input) {
  const out = {};
  for (const [key, fn] of Object.entries(SETTINGS_SCHEMA)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) out[key] = fn(input[key]);
  }
  return out;
}

function cleanProduct(input, store) {
  const variants = Array.isArray(input.variants)
    ? input.variants
        .map((v) => ({ name: str(v && v.name, 60), price: num(v && v.price) }))
        .filter((v) => v.name)
        .slice(0, 20)
    : [];
  const categoryId = str(input.categoryId, 20);
  return {
    name: str(input.name, 100),
    description: str(input.description, 600),
    price: variants.length ? Math.min(...variants.map((v) => v.price)) : num(input.price),
    comparePrice: num(input.comparePrice),
    image: imageUrl(input.image),
    emoji: str(input.emoji, 8),
    categoryId: store.db.categories.some((c) => c.id === categoryId) ? categoryId : '',
    available: input.available === undefined ? true : bool(input.available),
    featured: bool(input.featured),
    variants,
  };
}

function createApp({ dataDir }) {
  const store = new Store(dataDir);
  const app = express();
  const loginLimited = auth.rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const orderLimited = auth.rateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const baseUrl = (req) => `${req.protocol}://${req.get('host')}/`;
  const isSecure = (req) => req.secure;
  const pickLang = (req) => (LANGS.includes(req.query.lang) ? req.query.lang : store.settings.lang);

  const requireAuth = (req, res, next) => {
    if (auth.isAuthenticated(req, store.db)) return next();
    res.status(401).json({ error: 'unauthorized' });
  };

  // Simple CSRF defence for state-changing JSON calls: the session cookie is
  // SameSite=Strict, and we additionally require a custom header that
  // cross-site forms cannot set.
  const requireJsonHeader = (req, res, next) => {
    if (req.method === 'GET' || req.get('x-dukkan') === '1') return next();
    res.status(403).json({ error: 'forbidden' });
  };

  // ---------- static ----------
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
  app.use('/uploads', express.static(store.uploadsDir, { maxAge: '30d', immutable: true }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // ---------- storefront ----------
  app.get('/', (req, res) => {
    if (!store.db.setupDone) return res.redirect('/admin');
    const html = renderStore({
      settings: store.settings,
      categories: store.sortedCategories(),
      products: store.sortedProducts(),
      lang: pickLang(req),
      table: str(req.query.table, 20),
      baseUrl: baseUrl(req),
    });
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  });

  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').send(JSON.stringify(renderManifest(store.settings)));
  });

  app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

  // ---------- public API ----------
  const api = express.Router();
  api.use(express.json({ limit: '6mb' }));
  api.use(requireJsonHeader);

  api.post('/orders', (req, res) => {
    if (orderLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const result = buildOrder(req.body, store);
    if (result.error) return res.status(400).json(result);
    const order = store.addOrder(result.order);
    const text = whatsappMessage(order, store.settings);
    res.json({ no: order.no, total: order.total, whatsappUrl: whatsappUrl(store.settings.whatsapp, text) });
  });

  api.get('/state', (req, res) => {
    res.json({
      setupDone: store.db.setupDone,
      authed: auth.isAuthenticated(req, store.db),
      lang: store.settings.lang,
    });
  });

  api.post('/setup', (req, res) => {
    if (store.db.setupDone) return res.status(409).json({ error: 'already_setup' });
    const b = req.body || {};
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.updateSettings(cleanSettings({ name: b.name, whatsapp: b.whatsapp, currency: b.currency, lang: b.lang }));
    store.db.auth = auth.hashPassword(password);
    store.db.setupDone = true;
    store.save();
    if (bool(b.sample)) loadSample(store, store.settings.lang);
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, isSecure(req)));
    res.json({ ok: true });
  });

  api.post('/login', (req, res) => {
    if (loginLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    if (!auth.verifyPassword(req.body && req.body.password, store.db.auth)) {
      return res.status(401).json({ error: 'wrong_password' });
    }
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, isSecure(req)));
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearSessionCookie());
    res.json({ ok: true });
  });

  // ---------- admin API ----------
  const admin = express.Router();
  admin.use(requireAuth);

  admin.get('/data', (req, res) => {
    res.json({
      settings: store.settings,
      categories: store.sortedCategories(),
      products: store.sortedProducts(),
      baseUrl: baseUrl(req),
    });
  });

  admin.put('/settings', (req, res) => {
    const before = { logo: store.settings.logo, cover: store.settings.cover };
    const settings = store.updateSettings(cleanSettings(req.body));
    store.removeUploadIfUnused(before.logo);
    store.removeUploadIfUnused(before.cover);
    res.json({ settings });
  });

  admin.put('/password', (req, res) => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(current, store.db.auth)) return res.status(401).json({ error: 'wrong_password' });
    if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.db.auth = auth.hashPassword(next);
    store.save();
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, isSecure(req)));
    res.json({ ok: true });
  });

  admin.post('/categories', (req, res) => {
    const name = str(req.body && req.body.name, 60);
    if (!name) return res.status(400).json({ error: 'name_required' });
    res.json(store.addCategory({ name }));
  });

  admin.put('/categories/:id', (req, res) => {
    const name = str(req.body && req.body.name, 60);
    if (!name) return res.status(400).json({ error: 'name_required' });
    const cat = store.updateCategory(req.params.id, { name });
    if (!cat) return res.status(404).json({ error: 'not_found' });
    res.json(cat);
  });

  admin.delete('/categories/:id', (req, res) => {
    if (!store.deleteCategory(req.params.id)) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  admin.post('/reorder', (req, res) => {
    const { collection, ids } = req.body || {};
    if (!['categories', 'products'].includes(collection) || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'invalid' });
    }
    store.reorder(collection, ids.map(String));
    res.json({ ok: true });
  });

  admin.post('/products', (req, res) => {
    const data = cleanProduct(req.body || {}, store);
    if (!data.name) return res.status(400).json({ error: 'name_required' });
    res.json(store.addProduct(data));
  });

  admin.put('/products/:id', (req, res) => {
    const existing = store.getProduct(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const oldImage = existing.image;
    // Allow partial updates (e.g. toggling availability from the list).
    const merged = cleanProduct({ ...existing, ...req.body }, store);
    if (!merged.name) return res.status(400).json({ error: 'name_required' });
    const product = store.updateProduct(req.params.id, merged);
    if (oldImage !== product.image) store.removeUploadIfUnused(oldImage);
    res.json(product);
  });

  admin.delete('/products/:id', (req, res) => {
    const product = store.deleteProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'not_found' });
    store.removeUploadIfUnused(product.image);
    res.json({ ok: true });
  });

  admin.post('/upload', (req, res) => {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      (req.body && req.body.dataUrl) || ''
    );
    if (!match) return res.status(400).json({ error: 'invalid_image' });
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'too_large' });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${IMAGE_TYPES[match[1]]}`;
    fs.writeFileSync(path.join(store.uploadsDir, name), buf);
    res.json({ url: `/uploads/${name}` });
  });

  admin.get('/orders', (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const list = store.orders.filter((o) => !status || o.status === status);
    res.json({ orders: list.slice(-300).reverse(), counts: countByStatus(store.orders) });
  });

  admin.put('/orders/:id', (req, res) => {
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    const order = store.updateOrderStatus(req.params.id, status);
    if (!order) return res.status(404).json({ error: 'not_found' });
    res.json(order);
  });

  admin.get('/stats', (req, res) => res.json(computeStats(store)));

  admin.get('/qr.svg', async (req, res) => {
    const text = str(req.query.text, 500) || baseUrl(req);
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  });

  admin.get('/export', (req, res) => {
    const { settings, categories, products } = store.db;
    res.setHeader('Content-Disposition', `attachment; filename="dukkan-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ app: 'dukkan', version: 1, exportedAt: new Date().toISOString(), settings, categories, products, orders: store.orders });
  });

  admin.post('/import', (req, res) => {
    const b = req.body || {};
    if (b.app !== 'dukkan' || !Array.isArray(b.categories) || !Array.isArray(b.products)) {
      return res.status(400).json({ error: 'invalid_backup' });
    }
    store.db.settings = { ...DEFAULT_SETTINGS, ...cleanSettings(b.settings || {}) };
    store.db.categories = b.categories
      .map((c, i) => ({ id: str(c.id, 20), name: str(c.name, 60), sort: i + 1 }))
      .filter((c) => c.id && c.name);
    store.db.products = [];
    b.products.forEach((p, i) => {
      const data = cleanProduct(p, store);
      if (data.name) store.db.products.push({ id: str(p.id, 20) || crypto.randomBytes(6).toString('base64url'), sort: i + 1, createdAt: p.createdAt || new Date().toISOString(), ...data });
    });
    store.save();
    res.json({ ok: true });
  });

  api.use('/admin', admin);
  app.use('/api', api);

  // Printable QR posters (shop + one per table).
  app.get('/admin/print-qr', async (req, res) => {
    if (!auth.isAuthenticated(req, store.db)) return res.redirect('/admin');
    const tables = Math.min(Math.max(parseInt(req.query.tables, 10) || 0, 0), 100);
    const base = baseUrl(req);
    const targets = [{ label: '', url: base }];
    for (let i = 1; i <= tables; i++) targets.push({ label: `🪑 ${i}`, url: `${base}?table=${i}` });
    const items = await Promise.all(
      targets.map(async (tg) => ({ ...tg, svg: await QRCode.toString(tg.url, { type: 'svg', margin: 1 }) }))
    );
    res.type('html').send(renderQrPrint({ settings: store.settings, items, lang: store.settings.lang }));
  });

  app.use((req, res) => res.status(404).type('text').send('Not found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  app.locals.store = store;
  return app;
}

function countByStatus(orders) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const o of orders) counts[o.status] = (counts[o.status] || 0) + 1;
  counts.all = orders.length;
  return counts;
}

function computeStats(store) {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const valid = store.orders.filter((o) => o.status !== 'cancelled');
  const since = (ms) => valid.filter((o) => Date.parse(o.createdAt) >= ms);
  const sum = (list) => Math.round(list.reduce((s, o) => s + o.total, 0) * 100) / 100;

  const today = since(dayStart.getTime());
  const week = since(now - 7 * 864e5);
  const month = since(now - 30 * 864e5);

  const top = new Map();
  for (const o of month) {
    for (const i of o.items) {
      const t = top.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
      t.qty += i.qty;
      t.revenue += i.price * i.qty;
      top.set(i.name, t);
    }
  }

  // Orders per day for the last 14 days (for a sparkline).
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const start = new Date(dayStart.getTime() - d * 864e5);
    const end = start.getTime() + 864e5;
    const list = valid.filter((o) => {
      const t = Date.parse(o.createdAt);
      return t >= start.getTime() && t < end;
    });
    days.push({ date: start.toISOString().slice(0, 10), orders: list.length, revenue: sum(list) });
  }

  return {
    today: { orders: today.length, revenue: sum(today) },
    week: { orders: week.length, revenue: sum(week) },
    month: { orders: month.length, revenue: sum(month), avg: month.length ? Math.round((sum(month) / month.length) * 100) / 100 : 0 },
    newOrders: store.orders.filter((o) => o.status === 'new').length,
    top: [...top.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
    days,
    products: store.db.products.length,
  };
}

module.exports = { createApp };
