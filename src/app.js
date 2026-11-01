'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');

const { Store, defaultSettings, localDate } = require('./store');
const auth = require('./auth');
const { LANGS, LANGUAGES, adminStrings } = require('./i18n');
const { loadSample } = require('./sample');
const { cleanSchedule, nextOpeningLabel, isOpen } = require('./schedule');
const { productsFromCsv, productsToCsv, templateCsv } = require('./csv');
const { resetDemo } = require('./demo');
const {
  buildOrder,
  priceItems,
  applyCoupon,
  canOrder,
  whatsappMessage,
  whatsappUrl,
  STATUSES,
} = require('./orders');
const { renderStore, renderQrPrint, renderReceipt, renderManifest } = require('./views');
const { cleanTheme, cleanFont, appearanceOptions } = require('./theme');
const notify = require('./notify');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless/i;

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
const shortId = () => crypto.randomBytes(4).toString('base64url');

const SETTINGS_SCHEMA = {
  name: (v) => str(v, 80) || 'My Shop',
  tagline: (v) => str(v, 140),
  about: (v) => str(v, 1000),
  logo: imageUrl,
  cover: imageUrl,
  whatsapp: (v) => str(v, 30).replace(/[^\d+]/g, ''),
  currency: (v) => str(v, 12),
  lang: (v) => (LANGS.includes(v) ? v : 'en'),
  color: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : defaultSettings().color),
  theme: cleanTheme,
  font: cleanFont,
  acceptingOrders: bool,
  closedMessage: (v) => str(v, 200),
  delivery: bool,
  deliveryFee: num,
  freeDeliveryOver: num,
  minOrder: num,
  zones: (v) =>
    (Array.isArray(v) ? v : [])
      .map((z) => ({ id: str(z && z.id, 20) || shortId(), name: str(z && z.name, 60), fee: num(z && z.fee) }))
      .filter((z) => z.name)
      .slice(0, 50),
  pickup: bool,
  dineIn: bool,
  schedule: cleanSchedule,
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

function cleanCoupon(input) {
  return {
    code: str(input.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
    type: input.type === 'fixed' ? 'fixed' : 'percent',
    value: input.type === 'fixed' ? num(input.value) : Math.min(num(input.value), 100),
    minOrder: num(input.minOrder),
    maxUses: Math.floor(num(input.maxUses)),
    active: input.active === undefined ? true : bool(input.active),
  };
}

// Setup codes avoid look-alike characters (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateSetupCode() {
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * @param {object} opts
 * @param {string} opts.dataDir   where data is stored
 * @param {string} [opts.setupCode] fixed first-run setup code (else generated)
 * @param {object} [opts.demo]    demo config from demoConfig()
 * @param {boolean} [opts.quiet]  don't log the setup code
 */
function createApp({ dataDir, setupCode, demo = null, quiet = false }) {
  const store = new Store(dataDir);
  const app = express();
  const loginLimited = auth.rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const setupLimited = auth.rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const orderLimited = auth.rateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
  const couponLimited = auth.rateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });

  // ---------- first-run protection ----------
  // Whoever opens a fresh install must prove they can see the server logs
  // (or know SETUP_CODE) before they can claim the admin account.
  if (demo) {
    resetDemo(store, demo);
    const timer = setInterval(() => resetDemo(store, demo), demo.resetMinutes * 60 * 1000);
    timer.unref();
  } else if (!store.db.setupDone) {
    if (setupCode) store.db.setupCode = setupCode;
    else if (!store.db.setupCode) store.db.setupCode = generateSetupCode();
    store.save();
    if (!quiet) {
      console.log('');
      console.log('  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Setup code: ${store.db.setupCode.padEnd(32)}│`);
      console.log('  │  Open /admin in your browser and enter it    │');
      console.log('  │  to create your shop.                        │');
      console.log('  └──────────────────────────────────────────────┘');
      console.log('');
    }
  }

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

  const notInDemo = (req, res, next) => (demo ? res.status(403).json({ error: 'demo' }) : next());

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
    const settings = store.settings;
    const lang = pickLang(req);
    const preview = req.query.preview === '1';

    // Roughly one visit per browser per day; bots and admins' previews aside.
    const today = localDate();
    const cookies = req.headers.cookie || '';
    if (!preview && !BOT_RE.test(req.get('user-agent') || '') && !cookies.includes(`dk_v=${today}`)) {
      store.recordVisit(today);
      res.append('Set-Cookie', `dk_v=${today}; Path=/; Max-Age=86400; SameSite=Lax`);
    }

    const open = canOrder(settings);
    const html = renderStore({
      settings,
      categories: store.sortedCategories(),
      products: store.sortedProducts(),
      lang,
      table: str(req.query.table, 20),
      baseUrl: baseUrl(req),
      canOrder: open,
      closedBySchedule: settings.acceptingOrders && !isOpen(settings.schedule),
      opensAt: settings.acceptingOrders && !open ? nextOpeningLabel(settings.schedule, lang) : '',
      hasCoupons: store.db.coupons.some((c) => c.active),
      demo: !!demo,
      preview,
      languages: LANGUAGES,
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

  api.get('/i18n/:lang', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ strings: adminStrings(req.params.lang), languages: LANGUAGES });
  });

  api.post('/orders', (req, res) => {
    if (orderLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const result = buildOrder(req.body, store);
    if (result.error) return res.status(400).json(result);
    const order = store.addOrder(result.order);
    const text = whatsappMessage(order, store.settings);
    notify.notifyInBackground(store.db.notify, `${text}\n\n🔗 ${baseUrl(req)}admin#orders`);
    res.json({ no: order.no, total: order.total, whatsappUrl: whatsappUrl(store.settings.whatsapp, text) });
  });

  api.post('/coupon', (req, res) => {
    if (couponLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const priced = priceItems(b.items, store);
    if (priced.error) return res.status(400).json(priced);
    const result = applyCoupon(b.code, priced.subtotal, store);
    if (result.error) return res.status(400).json(result);
    res.json({ code: result.coupon.code, discount: result.discount });
  });

  api.get('/state', (req, res) => {
    res.json({
      setupDone: store.db.setupDone,
      authed: auth.isAuthenticated(req, store.db),
      lang: store.settings.lang,
      needsSetupCode: !store.db.setupDone,
      demo: demo ? { password: demo.password, resetMinutes: demo.resetMinutes } : null,
      languages: LANGUAGES,
    });
  });

  api.post('/setup', notInDemo, (req, res) => {
    if (store.db.setupDone) return res.status(409).json({ error: 'already_setup' });
    if (setupLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const given = normCode(b.setupCode);
    const expected = normCode(store.db.setupCode);
    if (!given || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(403).json({ error: 'invalid_setup_code' });
    }
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 8) return res.status(400).json({ error: 'weak_password' });
    const schedule = cleanSchedule({ ...store.settings.schedule, timezone: b.timezone });
    store.updateSettings({ ...cleanSettings({ name: b.name, whatsapp: b.whatsapp, currency: b.currency, lang: b.lang }), schedule });
    store.db.auth = auth.hashPassword(password);
    store.db.setupDone = true;
    delete store.db.setupCode;
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
  notify.mountRoutes(admin, store, { guard: notInDemo, appName: 'Dukkan' });

  admin.get('/data', (req, res) => {
    res.json({
      settings: store.settings,
      categories: store.sortedCategories(),
      products: store.sortedProducts(),
      coupons: store.db.coupons,
      baseUrl: baseUrl(req),
      open: canOrder(store.settings),
      demo: !!demo,
      appearance: appearanceOptions(store.settings.lang),
    });
  });

  admin.put('/settings', (req, res) => {
    const before = { logo: store.settings.logo, cover: store.settings.cover };
    const settings = store.updateSettings(cleanSettings(req.body));
    store.removeUploadIfUnused(before.logo);
    store.removeUploadIfUnused(before.cover);
    res.json({ settings, open: canOrder(settings) });
  });

  admin.put('/password', notInDemo, (req, res) => {
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

  // ---- CSV (Excel / Google Sheets) ----
  const sendCsv = (res, name, body) => {
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.type('text/csv; charset=utf-8').send(body);
  };
  admin.get('/products.csv', (req, res) =>
    sendCsv(res, 'dukkan-menu.csv', productsToCsv(store.sortedProducts(), store.sortedCategories()))
  );
  admin.get('/products-template.csv', (req, res) => sendCsv(res, 'dukkan-template.csv', templateCsv()));

  admin.post('/products/csv', (req, res) => {
    const b = req.body || {};
    const { products, errors } = productsFromCsv(typeof b.csv === 'string' ? b.csv : '');
    if (!products.length) return res.status(400).json({ error: 'invalid_csv', errors });
    if (bool(b.replace)) {
      store.db.products = [];
      store.db.categories = [];
    }
    const catByName = new Map(store.db.categories.map((c) => [c.name.trim().toLowerCase(), c]));
    for (const p of products.slice(0, 2000)) {
      let categoryId = '';
      const catName = str(p.category, 60);
      if (catName) {
        let cat = catByName.get(catName.toLowerCase());
        if (!cat) {
          cat = store.addCategory({ name: catName });
          catByName.set(catName.toLowerCase(), cat);
        }
        categoryId = cat.id;
      }
      const data = cleanProduct({ ...p, categoryId }, store);
      if (data.name) store.addProduct(data, { save: false });
    }
    store.save();
    res.json({ imported: Math.min(products.length, 2000), errors });
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

  // ---- coupons ----
  admin.post('/coupons', (req, res) => {
    const data = cleanCoupon(req.body || {});
    if (!data.code) return res.status(400).json({ error: 'code_required' });
    if (store.findCoupon(data.code)) return res.status(409).json({ error: 'coupon_exists' });
    res.json(store.addCoupon(data));
  });

  admin.put('/coupons/:id', (req, res) => {
    const existing = store.db.coupons.find((c) => c.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const data = cleanCoupon({ ...existing, ...req.body });
    if (!data.code) return res.status(400).json({ error: 'code_required' });
    const clash = store.findCoupon(data.code);
    if (clash && clash.id !== existing.id) return res.status(409).json({ error: 'coupon_exists' });
    res.json(store.updateCoupon(existing.id, data));
  });

  admin.delete('/coupons/:id', (req, res) => {
    if (!store.deleteCoupon(req.params.id)) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  // ---- orders & stats ----
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

  // ---- backup ----
  admin.get('/export', (req, res) => {
    const { settings, categories, products, coupons } = store.db;
    res.setHeader('Content-Disposition', `attachment; filename="dukkan-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ app: 'dukkan', version: 1, exportedAt: new Date().toISOString(), settings, categories, products, coupons, orders: store.orders });
  });

  admin.post('/import', notInDemo, (req, res) => {
    const b = req.body || {};
    if (b.app !== 'dukkan' || !Array.isArray(b.categories) || !Array.isArray(b.products)) {
      return res.status(400).json({ error: 'invalid_backup' });
    }
    store.db.settings = { ...defaultSettings(), ...cleanSettings(b.settings || {}) };
    store.db.categories = b.categories
      .map((c, i) => ({ id: str(c.id, 20), name: str(c.name, 60), sort: i + 1 }))
      .filter((c) => c.id && c.name);
    store.db.products = [];
    b.products.forEach((p, i) => {
      const data = cleanProduct(p, store);
      if (data.name) store.db.products.push({ id: str(p.id, 20) || crypto.randomBytes(6).toString('base64url'), sort: i + 1, createdAt: p.createdAt || new Date().toISOString(), ...data });
    });
    if (Array.isArray(b.coupons)) {
      store.db.coupons = b.coupons
        .map((c) => ({ id: str(c.id, 20) || shortId(), uses: Math.floor(num(c.uses)), createdAt: c.createdAt || new Date().toISOString(), ...cleanCoupon(c) }))
        .filter((c) => c.code);
    }
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

  // Printable 80mm receipt for one order.
  app.get('/admin/receipt/:id', (req, res) => {
    if (!auth.isAuthenticated(req, store.db)) return res.redirect('/admin');
    const order = store.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).type('text').send('Not found');
    res.type('html').send(renderReceipt({ settings: store.settings, order, lang: store.settings.lang }));
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
  app.locals.setupCode = store.db.setupCode;
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

  const between = (from, to) => valid.filter((o) => {
    const t = Date.parse(o.createdAt);
    return t >= from && t < to;
  });
  const today = since(dayStart.getTime());
  const week = since(now - 7 * 864e5);
  const month = since(now - 30 * 864e5);
  const prevMonth = between(now - 60 * 864e5, now - 30 * 864e5);
  const yesterday = between(dayStart.getTime() - 864e5, now - 864e5);

  // When people order: by hour of day, and by method (last 30 days).
  const hours = Array(24).fill(0);
  const methods = { delivery: 0, pickup: 0, dineIn: 0 };
  for (const o of month) {
    hours[new Date(o.createdAt).getHours()]++;
    if (o.method in methods) methods[o.method]++;
  }

  const top = new Map();
  for (const o of month) {
    for (const i of o.items) {
      const t = top.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
      t.qty += i.qty;
      t.revenue += i.price * i.qty;
      top.set(i.name, t);
    }
  }

  // Orders per day for the last 14 days (for the chart).
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

  // Visits: last 30 days, keyed by local date.
  let visits30 = 0;
  let visitsPrev = 0;
  for (let d = 0; d < 30; d++) visits30 += store.stats.visits[localDate(new Date(now - d * 864e5))] || 0;
  for (let d = 30; d < 60; d++) visitsPrev += store.stats.visits[localDate(new Date(now - d * 864e5))] || 0;
  // % change; hidden when the previous period is too small to compare meaningfully.
  const change = (cur, prev, minPrev = 0) => (prev && prev >= minPrev ? Math.round(((cur - prev) / prev) * 100) : null);
  const visitsToday = store.stats.visits[localDate()] || 0;
  const conversion = visits30 ? Math.min(100, Math.round((month.length / visits30) * 1000) / 10) : 0;

  return {
    today: { orders: today.length, revenue: sum(today), change: change(today.length, yesterday.length, 5) },
    week: { orders: week.length, revenue: sum(week) },
    month: {
      orders: month.length,
      revenue: sum(month),
      avg: month.length ? Math.round((sum(month) / month.length) * 100) / 100 : 0,
      change: change(sum(month), sum(prevMonth)),
      avgChange: change(month.length ? sum(month) / month.length : 0, prevMonth.length ? sum(prevMonth) / prevMonth.length : 0),
    },
    visits: { today: visitsToday, month: visits30, conversion, change: change(visits30, visitsPrev, 20) },
    hours,
    methods,
    newOrders: store.orders.filter((o) => o.status === 'new').length,
    top: [...top.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
    days,
    products: store.db.products.length,
  };
}

module.exports = { createApp, generateSetupCode };
