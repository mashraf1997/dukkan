'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { defaultSchedule } = require('./schedule');

const MAX_ORDERS = 10000;
const VISIT_DAYS = 120;

function newId() {
  return crypto.randomBytes(6).toString('base64url');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

// Write to a temp file then rename, so a crash mid-write never corrupts data.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultSettings() {
  return {
    name: 'My Shop',
    tagline: '',
    about: '',
    logo: '',
    cover: '',
    whatsapp: '',
    currency: 'EGP',
    lang: 'ar',
    color: '#0f766e',
    acceptingOrders: true,
    closedMessage: '',
    delivery: true,
    deliveryFee: 0,
    freeDeliveryOver: 0,
    minOrder: 0,
    zones: [],
    pickup: true,
    dineIn: false,
    schedule: defaultSchedule(),
    address: '',
    hours: '',
    phone: '',
    instagram: '',
    facebook: '',
    tiktok: '',
    mapUrl: '',
  };
}

function defaultDb() {
  return {
    version: 1,
    setupDone: false,
    secret: crypto.randomBytes(32).toString('hex'),
    auth: null,
    settings: defaultSettings(),
    categories: [],
    products: [],
    coupons: [],
    nextOrderNo: 1001,
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.dbFile = path.join(dir, 'db.json');
    this.ordersFile = path.join(dir, 'orders.json');
    this.statsFile = path.join(dir, 'stats.json');

    const db = readJson(this.dbFile);
    this.db = db || defaultDb();
    // Fill in anything added in newer versions.
    this.db.settings = { ...defaultSettings(), ...this.db.settings };
    if (!Array.isArray(this.db.coupons)) this.db.coupons = [];
    this.orders = readJson(this.ordersFile) || [];
    this.stats = readJson(this.statsFile) || { visits: {} };
    this.statsDirty = false;
    if (!db) this.save();
  }

  save() {
    writeJsonAtomic(this.dbFile, this.db);
  }

  saveOrders() {
    if (this.orders.length > MAX_ORDERS) this.orders = this.orders.slice(-MAX_ORDERS);
    writeJsonAtomic(this.ordersFile, this.orders);
  }

  get settings() {
    return this.db.settings;
  }

  updateSettings(patch) {
    this.db.settings = { ...this.db.settings, ...patch };
    this.save();
    return this.db.settings;
  }

  /** Wipes everything except the signing secret (used by demo mode). */
  reset() {
    const secret = this.db.secret;
    this.db = defaultDb();
    this.db.secret = secret;
    this.orders = [];
    this.stats = { visits: {} };
    for (const f of fs.readdirSync(this.uploadsDir)) fs.rmSync(path.join(this.uploadsDir, f), { force: true });
    this.save();
    this.saveOrders();
    this.flushStats(true);
  }

  // ---- categories ----
  sortedCategories() {
    return [...this.db.categories].sort((a, b) => a.sort - b.sort);
  }

  addCategory({ name }) {
    const sort = this.db.categories.reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    const cat = { id: newId(), name, sort };
    this.db.categories.push(cat);
    this.save();
    return cat;
  }

  updateCategory(id, { name }) {
    const cat = this.db.categories.find((c) => c.id === id);
    if (!cat) return null;
    cat.name = name;
    this.save();
    return cat;
  }

  deleteCategory(id) {
    const before = this.db.categories.length;
    this.db.categories = this.db.categories.filter((c) => c.id !== id);
    if (this.db.categories.length === before) return false;
    for (const p of this.db.products) if (p.categoryId === id) p.categoryId = '';
    this.save();
    return true;
  }

  reorder(collection, ids) {
    const list = this.db[collection];
    ids.forEach((id, i) => {
      const item = list.find((x) => x.id === id);
      if (item) item.sort = i + 1;
    });
    this.save();
  }

  // ---- products ----
  sortedProducts() {
    return [...this.db.products].sort((a, b) => a.sort - b.sort);
  }

  getProduct(id) {
    return this.db.products.find((p) => p.id === id) || null;
  }

  addProduct(data, { save = true } = {}) {
    const sort = this.db.products.reduce((m, p) => Math.max(m, p.sort), 0) + 1;
    const product = { id: newId(), sort, createdAt: new Date().toISOString(), ...data };
    this.db.products.push(product);
    if (save) this.save();
    return product;
  }

  updateProduct(id, data) {
    const product = this.getProduct(id);
    if (!product) return null;
    Object.assign(product, data);
    this.save();
    return product;
  }

  deleteProduct(id) {
    const product = this.getProduct(id);
    if (!product) return null;
    this.db.products = this.db.products.filter((p) => p.id !== id);
    this.save();
    return product;
  }

  // ---- coupons ----
  findCoupon(code) {
    const c = String(code || '').trim().toUpperCase();
    return c ? this.db.coupons.find((x) => x.code === c) || null : null;
  }

  addCoupon(data) {
    const coupon = { id: newId(), uses: 0, createdAt: new Date().toISOString(), ...data };
    this.db.coupons.push(coupon);
    this.save();
    return coupon;
  }

  updateCoupon(id, data) {
    const coupon = this.db.coupons.find((c) => c.id === id);
    if (!coupon) return null;
    Object.assign(coupon, data);
    this.save();
    return coupon;
  }

  deleteCoupon(id) {
    const before = this.db.coupons.length;
    this.db.coupons = this.db.coupons.filter((c) => c.id !== id);
    if (before === this.db.coupons.length) return false;
    this.save();
    return true;
  }

  // ---- orders ----
  addOrder(order) {
    const full = {
      id: newId(),
      no: this.db.nextOrderNo++,
      createdAt: new Date().toISOString(),
      status: 'new',
      ...order,
    };
    if (full.coupon) {
      const c = this.findCoupon(full.coupon);
      if (c) c.uses = (c.uses || 0) + 1;
    }
    this.save();
    this.orders.push(full);
    this.saveOrders();
    return full;
  }

  updateOrderStatus(id, status) {
    const order = this.orders.find((o) => o.id === id);
    if (!order) return null;
    order.status = status;
    this.saveOrders();
    return order;
  }

  // ---- visits (written at most every few seconds) ----
  recordVisit(date = localDate()) {
    this.stats.visits[date] = (this.stats.visits[date] || 0) + 1;
    this.statsDirty = true;
    if (!this.statsTimer) {
      this.statsTimer = setTimeout(() => this.flushStats(), 5000);
      this.statsTimer.unref();
    }
  }

  flushStats(force) {
    clearTimeout(this.statsTimer);
    this.statsTimer = null;
    if (!this.statsDirty && !force) return;
    const keep = Object.keys(this.stats.visits).sort().slice(-VISIT_DAYS);
    this.stats.visits = Object.fromEntries(keep.map((k) => [k, this.stats.visits[k]]));
    writeJsonAtomic(this.statsFile, this.stats);
    this.statsDirty = false;
  }

  // ---- uploads ----
  isImageInUse(url) {
    const s = this.db.settings;
    if (s.logo === url || s.cover === url) return true;
    return this.db.products.some((p) => p.image === url);
  }

  removeUploadIfUnused(url) {
    if (!url || !url.startsWith('/uploads/') || this.isImageInUse(url)) return;
    const file = path.join(this.uploadsDir, path.basename(url));
    fs.rm(file, { force: true }, () => {});
  }
}

module.exports = { Store, defaultSettings, newId, localDate };
