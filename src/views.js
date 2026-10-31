'use strict';

const { strings } = require('./i18n');
const { formatMoney, enabledMethods } = require('./orders');

const VERSION = require('../package.json').version;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON that is safe to inline inside a <script> tag.
function inlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#0f766e';
}

function safeUrl(url) {
  const u = String(url || '').trim();
  return /^(https?:\/\/|\/uploads\/)/i.test(u) ? u : '';
}

function socialUrl(kind, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, '');
  return {
    instagram: `https://instagram.com/${encodeURIComponent(handle)}`,
    facebook: `https://facebook.com/${encodeURIComponent(handle)}`,
    tiktok: `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
  }[kind];
}

function initials(name) {
  return (String(name || '?').trim()[0] || '?').toUpperCase();
}

function productPriceLabel(p, currency, t) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  if (variants.length) {
    const min = Math.min(...variants.map((v) => Number(v.price) || 0));
    return `${variants.length > 1 ? `${t.from} ` : ''}${formatMoney(min, currency)}`;
  }
  return formatMoney(p.price, currency);
}

function renderThumb(p) {
  const img = safeUrl(p.image);
  if (img) return `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">`;
  return `<span class="emoji" aria-hidden="true">${esc(p.emoji || initials(p.name))}</span>`;
}

function renderProduct(p, s, t) {
  const soldOut = !p.available;
  const compare = Number(p.comparePrice) > 0 && !(p.variants || []).length
    ? `<s class="compare">${esc(formatMoney(p.comparePrice, s.currency))}</s>`
    : '';
  const search = `${p.name} ${p.description || ''}`.toLowerCase();
  return `<article class="card${soldOut ? ' soldout' : ''}" data-id="${esc(p.id)}" data-search="${esc(search)}" tabindex="0" role="button" aria-label="${esc(p.name)}">
  <div class="info">
    ${p.featured ? `<span class="badge">⭐ ${esc(t.featured)}</span>` : ''}
    <h3>${esc(p.name)}</h3>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    <div class="price-row"><span class="price">${esc(productPriceLabel(p, s.currency, t))}</span>${compare}${soldOut ? `<span class="soldout-tag">${esc(t.soldOut)}</span>` : ''}</div>
  </div>
  <div class="thumb">${renderThumb(p)}${soldOut ? '' : `<button class="add" type="button" aria-label="${esc(t.add)}" data-add="${esc(p.id)}">+</button>`}</div>
</article>`;
}

function renderStore({
  settings: s,
  categories,
  products,
  lang,
  table,
  baseUrl,
  canOrder = !!s.acceptingOrders,
  closedBySchedule = false,
  opensAt = '',
  hasCoupons = false,
  demo = false,
  languages = [],
}) {
  const t = strings(lang);
  const color = safeColor(s.color);
  const cover = safeUrl(s.cover);
  const logo = safeUrl(s.logo);
  const visible = products;

  const sections = [];
  const catIds = new Set(categories.map((c) => c.id));
  for (const c of categories) {
    const items = visible.filter((p) => p.categoryId === c.id);
    if (items.length) sections.push({ id: c.id, name: c.name, items });
  }
  const loose = visible.filter((p) => !catIds.has(p.categoryId));
  if (loose.length) sections.push({ id: 'other', name: sections.length ? '…' : '', items: loose });

  const langMenu = languages.length > 1
    ? `<label class="lang"><span aria-hidden="true">🌐</span><select id="lang" aria-label="${esc(t.language)}">${languages
        .map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`)
        .join('')}</select></label>`
    : '';
  let closedText = '';
  if (!canOrder) {
    closedText = closedBySchedule
      ? `${t.closedNow}${opensAt ? ` · ${t.opensAt.replace('{time}', opensAt)}` : ''}`
      : s.closedMessage || t.closed;
  }
  const methods = enabledMethods(s);

  const contactLinks = [
    s.whatsapp && `<a href="https://wa.me/${esc(String(s.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">💬 WhatsApp</a>`,
    s.phone && `<a href="tel:${esc(s.phone)}">📞 ${esc(s.phone)}</a>`,
    s.instagram && `<a href="${esc(socialUrl('instagram', s.instagram))}" target="_blank" rel="noopener">📸 Instagram</a>`,
    s.facebook && `<a href="${esc(socialUrl('facebook', s.facebook))}" target="_blank" rel="noopener">👍 Facebook</a>`,
    s.tiktok && `<a href="${esc(socialUrl('tiktok', s.tiktok))}" target="_blank" rel="noopener">🎵 TikTok</a>`,
    safeUrl(s.mapUrl) && `<a href="${esc(safeUrl(s.mapUrl))}" target="_blank" rel="noopener">📍 ${esc(s.address || 'Map')}</a>`,
  ].filter(Boolean);

  const clientData = {
    lang,
    t,
    table: table || '',
    shop: {
      name: s.name,
      currency: s.currency,
      deliveryFee: Number(s.deliveryFee) || 0,
      freeDeliveryOver: Number(s.freeDeliveryOver) || 0,
      minOrder: Number(s.minOrder) || 0,
      methods,
      acceptingOrders: canOrder,
      closedText,
      zones: s.delivery ? (s.zones || []).map((z) => ({ id: z.id, name: z.name, fee: Number(z.fee) || 0 })) : [],
      hasCoupons,
    },
    products: visible.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: Number(p.price) || 0,
      comparePrice: Number(p.comparePrice) || 0,
      image: safeUrl(p.image),
      emoji: p.emoji || '',
      available: !!p.available,
      variants: (p.variants || []).map((v) => ({ name: v.name, price: Number(v.price) || 0 })),
    })),
  };

  const description = s.tagline || s.about || s.name;
  const ogImage = cover || logo;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: s.name,
    description,
    url: baseUrl,
    ...(ogImage ? { image: baseUrl + ogImage.replace(/^\//, '') } : {}),
    ...(s.address ? { address: s.address } : {}),
    ...(s.phone ? { telephone: s.phone } : {}),
  };

  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(s.name)}${s.tagline ? ` — ${esc(s.tagline)}` : ''}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${color}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(s.name)}">
<meta property="og:description" content="${esc(description)}">
${ogImage ? `<meta property="og:image" content="${esc(baseUrl + ogImage.replace(/^\//, ''))}">` : ''}
${languages.map((l) => `<link rel="alternate" hreflang="${esc(l.code)}" href="${esc(baseUrl)}?lang=${esc(l.code)}">`).join('\n')}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${logo ? esc(logo) : '/img/icon.svg'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/css/store.css?v=${VERSION}">
<style>:root{--brand:${color}}</style>
<script type="application/ld+json">${inlineJson(jsonLd)}</script>
</head>
<body>
<header class="hero${cover ? ' has-cover' : ''}"${cover ? ` style="--cover:url('${esc(cover)}')"` : ''}>
  <div class="hero-top">
    ${langMenu}
  </div>
  <div class="hero-body">
    <div class="logo">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}</div>
    <h1>${esc(s.name)}</h1>
    ${s.tagline ? `<p class="tagline">${esc(s.tagline)}</p>` : ''}
    <div class="meta">
      ${s.hours ? `<span>🕒 ${esc(s.hours)}</span>` : ''}
      ${table ? `<span class="pill">🪑 ${esc(t.yourTable)} ${esc(table)}</span>` : ''}
      ${s.freeDeliveryOver > 0 && s.delivery ? `<span>🚚 ${esc(t.freeDeliveryOver)} ${esc(formatMoney(s.freeDeliveryOver, s.currency))}</span>` : ''}
    </div>
  </div>
</header>
${demo ? `<div class="demo-banner" role="note">🧪 ${esc(t.demoBanner)}</div>` : ''}
${canOrder ? '' : `<div class="closed-banner" role="status">⏸️ ${esc(closedText)}</div>`}
<nav class="toolbar" aria-label="Menu">
  <div class="search"><input id="q" type="search" placeholder="${esc(t.search)}" autocomplete="off" aria-label="${esc(t.search)}"></div>
  ${sections.length > 1 ? `<div class="chips" id="chips">${sections
    .map((sec, i) => `<a href="#cat-${esc(sec.id)}" class="chip${i === 0 ? ' active' : ''}" data-cat="${esc(sec.id)}">${esc(sec.name)}</a>`)
    .join('')}</div>` : ''}
</nav>
<main id="menu">
${sections.length
    ? sections
        .map(
          (sec) => `<section class="cat" id="cat-${esc(sec.id)}" data-cat="${esc(sec.id)}">
  ${sec.name ? `<h2>${esc(sec.name)}</h2>` : ''}
  <div class="grid">${sec.items.map((p) => renderProduct(p, s, t)).join('')}</div>
</section>`
        )
        .join('\n')
    : `<p class="empty">${esc(t.noProducts)}</p>`}
<p class="empty" id="no-results" hidden>${esc(t.noResults)}</p>
</main>
<footer class="footer">
  ${s.about ? `<p class="about">${esc(s.about)}</p>` : ''}
  ${contactLinks.length ? `<div class="links">${contactLinks.join('')}</div>` : ''}
  <p class="powered">${esc(t.poweredBy)} <a href="https://github.com/mashraf1997/dukkan" target="_blank" rel="noopener">Dukkan</a></p>
</footer>

<div class="cartbar" id="cartbar" hidden>
  <button type="button" id="open-cart"><span class="count" id="cart-count">0</span><span>${esc(t.viewCart)}</span><span class="sum" id="cart-sum"></span></button>
</div>

<div class="sheet" id="sheet" hidden>
  <div class="backdrop" data-close></div>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <button class="close" type="button" data-close aria-label="Close">✕</button>
    <div id="sheet-body"></div>
  </div>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.DUKKAN=${inlineJson(clientData)};</script>
<script src="/js/store.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

function renderQrPrint({ settings: s, items, lang }) {
  const t = strings(lang);
  const color = safeColor(s.color);
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<title>QR — ${esc(s.name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap">
<style>
  *{box-sizing:border-box}
  body{font-family:Cairo,system-ui,sans-serif;margin:0;padding:24px;color:#111;background:#fff}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}
  .poster{border:3px solid ${color};border-radius:20px;padding:20px;text-align:center;break-inside:avoid;page-break-inside:avoid}
  .poster h2{margin:0;font-size:22px}
  .poster p{margin:4px 0 12px;color:${color};font-weight:800;font-size:18px}
  .poster svg{width:100%;max-width:220px;height:auto}
  .poster .label{display:inline-block;margin-top:8px;background:${color};color:#fff;border-radius:999px;padding:4px 16px;font-weight:800}
  .bar{margin-bottom:20px;display:flex;gap:12px}
  .bar button{font:inherit;padding:8px 18px;border-radius:10px;border:0;background:${color};color:#fff;cursor:pointer}
  @media print{.bar{display:none}body{padding:0}}
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()">🖨️ Print</button></div>
<div class="grid">
${items
  .map(
    (i) => `<div class="poster"><h2>${esc(s.name)}</h2><p>${esc(t.scanToOrder)}</p>${i.svg}${i.label ? `<div class="label">${esc(i.label)}</div>` : ''}</div>`
  )
  .join('\n')}
</div>
</body>
</html>`;
}

function renderManifest(s) {
  const logo = safeUrl(s.logo);
  return {
    name: s.name,
    short_name: String(s.name).slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: safeColor(s.color),
    icons: [logo ? { src: logo, sizes: '512x512' } : { src: '/img/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

module.exports = { renderStore, renderQrPrint, renderManifest, esc, safeColor, safeUrl };
