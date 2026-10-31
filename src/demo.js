'use strict';

// Demo mode: a public, self-resetting showcase (DEMO_MODE=true).
// Anyone can log in with DEMO_PASSWORD and play; everything is wiped
// and re-seeded every DEMO_RESET_MINUTES.

const auth = require('./auth');
const { loadSample } = require('./sample');

const DEMO_PASSWORD = 'demo1234';

function demoConfig(env = process.env) {
  if (!/^(1|true|yes)$/i.test(env.DEMO_MODE || '')) return null;
  return {
    password: env.DEMO_PASSWORD || DEMO_PASSWORD,
    resetMinutes: Math.max(5, Number(env.DEMO_RESET_MINUTES) || 60),
    lang: env.DEMO_LANG || 'en',
  };
}

// Deterministic pseudo-random numbers so every reset looks the same.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function seedOrders(store, now = Date.now()) {
  const r = rng(7);
  const products = store.db.products.filter((p) => p.available);
  const names = ['Sara', 'Omar', 'Lina', 'Yousef', 'Maya', 'Adam', 'Nour', 'Karim', 'Hana', 'Ali'];
  const methods = ['delivery', 'pickup', 'dineIn'];
  const orders = [];
  for (let d = 13; d >= 0; d--) {
    const n = Math.round(2 + r() * 4 + (13 - d) * 0.5);
    for (let k = 0; k < n; k++) {
      const items = [];
      const lines = 1 + Math.floor(r() * 3);
      for (let i = 0; i < lines; i++) {
        const p = products[Math.floor(r() * products.length)];
        const v = p.variants.length ? p.variants[Math.floor(r() * p.variants.length)] : null;
        items.push({ productId: p.id, name: p.name, variant: v ? v.name : '', price: v ? v.price : p.price, qty: 1 + Math.floor(r() * 2) });
      }
      const subtotal = Math.round(items.reduce((a, i) => a + i.price * i.qty, 0) * 100) / 100;
      const method = methods[Math.floor(r() * 3)];
      const fee = method === 'delivery' ? Number(store.settings.deliveryFee) || 0 : 0;
      const t = new Date(now - d * 864e5);
      t.setHours(8 + Math.floor(r() * 12), Math.floor(r() * 60));
      if (t.getTime() > now) t.setTime(now - Math.floor(r() * 36e5));
      orders.push({
        id: `demo${orders.length}`,
        createdAt: t.toISOString(),
        status: d > 0 ? (r() < 0.08 ? 'cancelled' : 'completed') : k < 2 ? 'new' : k < 4 ? 'confirmed' : 'completed',
        items,
        subtotal,
        discount: 0,
        coupon: '',
        deliveryFee: fee,
        total: subtotal + fee,
        method,
        zone: '',
        customer: {
          name: names[Math.floor(r() * names.length)],
          phone: `+1 415 555 01${10 + Math.floor(r() * 89)}`,
          address: method === 'delivery' ? '45 Oak Avenue, Apt 3' : '',
          notes: r() < 0.3 ? 'Oat milk please' : '',
        },
        table: method === 'dineIn' ? String(1 + Math.floor(r() * 8)) : '',
      });
    }
  }
  orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  orders.forEach((o, i) => (o.no = 1001 + i));
  store.orders = orders;
  store.db.nextOrderNo = 1001 + orders.length;

  // Some visits so the conversion figure means something.
  for (let d = 0; d < 30; d++) {
    const day = new Date(now - d * 864e5);
    const pad = (x) => String(x).padStart(2, '0');
    const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    store.stats.visits[key] = 40 + Math.floor(r() * 60);
  }
}

function resetDemo(store, cfg) {
  store.reset();
  const isAr = cfg.lang === 'ar';
  store.updateSettings({
    name: isAr ? 'كافيه بُنّ' : 'Bean & Bloom',
    lang: cfg.lang,
    currency: isAr ? 'ج.م' : '$',
    whatsapp: '',
    color: '#7c3aed',
    dineIn: true,
    deliveryFee: isAr ? 15 : 2,
    freeDeliveryOver: isAr ? 300 : 20,
    instagram: '@dukkan',
    address: isAr ? 'شارع 9، المعادي' : '12 Market St',
  });
  store.db.auth = auth.hashPassword(cfg.password);
  store.db.setupDone = true;
  loadSample(store, cfg.lang);
  store.addCoupon({ code: 'WELCOME10', type: 'percent', value: 10, minOrder: 0, maxUses: 0, active: true });
  seedOrders(store);
  store.save();
  store.saveOrders();
  store.flushStats(true);
}

module.exports = { demoConfig, resetDemo, seedOrders, DEMO_PASSWORD };
