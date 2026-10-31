'use strict';

const { strings } = require('./i18n');

const METHODS = ['delivery', 'pickup', 'dineIn'];
const STATUSES = ['new', 'confirmed', 'completed', 'cancelled'];
const MAX_LINES = 100;
const MAX_QTY = 999;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Symbols that are conventionally written before the amount ($5, €5, £5).
const PREFIX_SYMBOLS = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];

function formatMoney(amount, currency) {
  const n = round2(Number(amount) || 0);
  const str = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (!currency) return str;
  return PREFIX_SYMBOLS.includes(currency) ? `${currency}${str}` : `${str} ${currency}`;
}

function clean(value, max = 300) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function enabledMethods(settings) {
  return METHODS.filter((m) => settings[m]);
}

function deliveryFeeFor(settings, method, subtotal) {
  if (method !== 'delivery') return 0;
  const fee = Number(settings.deliveryFee) || 0;
  const freeOver = Number(settings.freeDeliveryOver) || 0;
  if (freeOver > 0 && subtotal >= freeOver) return 0;
  return fee;
}

/**
 * Validates a cart sent by a customer and prices it from the catalog.
 * Never trusts prices sent by the client.
 * Returns { order } or { error }.
 */
function buildOrder(input, store) {
  const settings = store.settings;
  if (!settings.acceptingOrders) return { error: 'closed' };
  if (!input || !Array.isArray(input.items) || input.items.length === 0) return { error: 'empty' };
  if (input.items.length > MAX_LINES) return { error: 'too_many_items' };

  const method = METHODS.includes(input.method) ? input.method : null;
  if (!method || !settings[method]) return { error: 'invalid_method' };

  const items = [];
  for (const line of input.items) {
    const product = store.getProduct(line && line.id);
    if (!product || !product.available) return { error: 'unavailable', productId: line && line.id };
    const qty = Math.floor(Number(line.qty));
    if (!(qty >= 1 && qty <= MAX_QTY)) return { error: 'invalid_qty' };

    let price = Number(product.price) || 0;
    let variant = '';
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length) {
      const v = variants.find((x) => x.name === line.variant);
      if (!v) return { error: 'invalid_variant', productId: product.id };
      variant = v.name;
      price = Number(v.price) || 0;
    }
    items.push({ productId: product.id, name: product.name, variant, price, qty });
  }

  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  const minOrder = Number(settings.minOrder) || 0;
  if (minOrder > 0 && subtotal < minOrder) return { error: 'below_minimum' };

  const c = input.customer || {};
  const customer = {
    name: clean(c.name, 80),
    phone: clean(c.phone, 30),
    address: method === 'delivery' ? clean(c.address, 300) : '',
    notes: clean(c.notes, 500),
  };
  if (!customer.name) return { error: 'name_required' };
  if (method === 'delivery' && !customer.address) return { error: 'address_required' };
  if (method !== 'dineIn' && !customer.phone) return { error: 'phone_required' };

  const table = method === 'dineIn' ? clean(String(input.table || ''), 20) : '';
  if (method === 'dineIn' && !table) return { error: 'table_required' };

  const deliveryFee = round2(deliveryFeeFor(settings, method, subtotal));
  return {
    order: { items, subtotal, deliveryFee, total: round2(subtotal + deliveryFee), method, customer, table },
  };
}

function whatsappMessage(order, settings) {
  const t = strings(settings.lang);
  const cur = settings.currency;
  const line = '━━━━━━━━━━';
  const out = [`🛒 *${t.msgNewOrder} #${order.no}*`, `🏪 ${settings.name}`, line];
  for (const i of order.items) {
    const name = i.variant ? `${i.name} (${i.variant})` : i.name;
    out.push(`${i.qty}× ${name} — ${formatMoney(i.price * i.qty, cur)}`);
  }
  out.push(line);
  out.push(`${t.subtotal}: ${formatMoney(order.subtotal, cur)}`);
  if (order.method === 'delivery') {
    out.push(`${t.deliveryFee}: ${order.deliveryFee ? formatMoney(order.deliveryFee, cur) : t.free}`);
  }
  out.push(`*${t.total}: ${formatMoney(order.total, cur)}*`, '');

  const methodIcon = { delivery: '🚚', pickup: '🛍️', dineIn: '🍽️' }[order.method];
  out.push(`${methodIcon} ${t[order.method]}`);
  if (order.table) out.push(`🪑 ${t.msgTable}: ${order.table}`);
  out.push(`👤 ${t.msgCustomer}: ${order.customer.name}`);
  if (order.customer.phone) out.push(`📞 ${t.msgPhone}: ${order.customer.phone}`);
  if (order.customer.address) out.push(`📍 ${t.msgAddress}: ${order.customer.address}`);
  if (order.customer.notes) out.push(`📝 ${t.msgNotes}: ${order.customer.notes}`);
  return out.join('\n');
}

function whatsappDigits(number) {
  return String(number || '').replace(/\D/g, '');
}

function whatsappUrl(number, text) {
  const digits = whatsappDigits(number);
  const q = `text=${encodeURIComponent(text)}`;
  return digits ? `https://wa.me/${digits}?${q}` : `https://wa.me/?${q}`;
}

module.exports = {
  METHODS,
  STATUSES,
  buildOrder,
  whatsappMessage,
  whatsappUrl,
  whatsappDigits,
  formatMoney,
  enabledMethods,
  deliveryFeeFor,
};
