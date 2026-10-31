'use strict';

// Minimal RFC 4180 CSV reader/writer that copes with what Excel and Google
// Sheets produce: BOM, CRLF, quoted fields, and ; or tab as delimiter.

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

function parseCsv(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// BOM so Excel opens UTF-8 (Arabic, Hindi…) correctly.
function toCsv(rows) {
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// ---- product mapping ----
const COLUMNS = ['category', 'name', 'description', 'price', 'sizes', 'compare_price', 'emoji', 'image_url', 'available', 'featured'];
const normHeader = (h) => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_');

function parseBool(v, fallback) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return fallback;
  return ['1', 'yes', 'true', 'y', 'x', '✓', 'نعم', 'sí', 'si', 'sim', 'oui', 'evet', 'ya', 'हाँ'].includes(s);
}

function parseNumber(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// "Small:3 | Large:4.5"
function parseSizes(v) {
  return String(v || '')
    .split('|')
    .map((part) => {
      const i = part.lastIndexOf(':');
      if (i < 0) return null;
      return { name: part.slice(0, i).trim(), price: parseNumber(part.slice(i + 1)) };
    })
    .filter((s) => s && s.name);
}

/** Turns CSV text into product rows. Returns { products, errors }. */
function productsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { products: [], errors: [{ line: 1, error: 'empty' }] };
  const header = rows[0].map(normHeader);
  const idx = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
  if (idx.name < 0) return { products: [], errors: [{ line: 1, error: 'missing_name_column' }] };

  const products = [];
  const errors = [];
  rows.slice(1).forEach((r, i) => {
    const get = (c) => (idx[c] >= 0 ? String(r[idx[c]] || '').trim() : '');
    const name = get('name');
    if (!name) return errors.push({ line: i + 2, error: 'name_required' });
    products.push({
      category: get('category'),
      name,
      description: get('description'),
      price: parseNumber(get('price')),
      variants: parseSizes(get('sizes')),
      comparePrice: parseNumber(get('compare_price')),
      emoji: get('emoji'),
      image: get('image_url'),
      available: parseBool(get('available'), true),
      featured: parseBool(get('featured'), false),
    });
  });
  return { products, errors };
}

function productsToCsv(products, categories) {
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || '';
  return toCsv([
    COLUMNS,
    ...products.map((p) => [
      catName(p.categoryId),
      p.name,
      p.description || '',
      (p.variants || []).length ? '' : p.price,
      (p.variants || []).map((v) => `${v.name}:${v.price}`).join(' | '),
      p.comparePrice || '',
      p.emoji || '',
      /^https?:\/\//.test(p.image || '') ? p.image : '',
      p.available ? 'yes' : 'no',
      p.featured ? 'yes' : 'no',
    ]),
  ]);
}

const TEMPLATE_ROWS = [
  COLUMNS,
  ['Pizza', 'Margherita', 'Tomato, mozzarella, basil', '', 'Medium:8 | Large:11', '', '🍕', '', 'yes', 'yes'],
  ['Pizza', 'Pepperoni', '', '', 'Medium:9 | Large:12', '', '🍕', '', 'yes', 'no'],
  ['Drinks', 'Lemonade', 'Fresh lemons and mint', '3', '', '4', '🍋', '', 'yes', 'no'],
];

module.exports = { parseCsv, toCsv, productsFromCsv, productsToCsv, templateCsv: () => toCsv(TEMPLATE_ROWS), COLUMNS };
