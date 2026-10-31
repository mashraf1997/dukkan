'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_ORDERS = 10000;

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

const DEFAULT_SETTINGS = {
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
  pickup: true,
  dineIn: false,
  address: '',
  hours: '',
  phone: '',
  instagram: '',
  facebook: '',
  tiktok: '',
  mapUrl: '',
};

function defaultDb() {
  return {
    version: 1,
    setupDone: false,
    secret: crypto.randomBytes(32).toString('hex'),
    auth: null,
    settings: { ...DEFAULT_SETTINGS },
    categories: [],
    products: [],
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

    const db = readJson(this.dbFile);
    this.db = db || defaultDb();
    // Fill in any settings added in newer versions.
    this.db.settings = { ...DEFAULT_SETTINGS, ...this.db.settings };
    this.orders = readJson(this.ordersFile) || [];
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

  addProduct(data) {
    const sort = this.db.products.reduce((m, p) => Math.max(m, p.sort), 0) + 1;
    const product = { id: newId(), sort, createdAt: new Date().toISOString(), ...data };
    this.db.products.push(product);
    this.save();
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

  // ---- orders ----
  addOrder(order) {
    const full = {
      id: newId(),
      no: this.db.nextOrderNo++,
      createdAt: new Date().toISOString(),
      status: 'new',
      ...order,
    };
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

module.exports = { Store, DEFAULT_SETTINGS, newId };
