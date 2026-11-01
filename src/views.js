'use strict';

const { strings } = require('./i18n');
const { formatMoney, enabledMethods } = require('./orders');
const { cleanTheme, fontHref, fontStack, hueFor } = require('./theme');

const VERSION = require('../package.json').version;
const ICONS = `/img/icons.svg?v=${VERSION}`;

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

const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;

function productPriceLabel(p, currency, t) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  if (variants.length) {
    const min = Math.min(...variants.map((v) => Number(v.price) || 0));
    return `${variants.length > 1 ? `${t.from} ` : ''}${formatMoney(min, currency)}`;
  }
  return formatMoney(p.price, currency);
}

function discountPercent(p) {
  const price = Number(p.price) || 0;
  const compare = Number(p.comparePrice) || 0;
  if ((p.variants || []).length || !(compare > price) || !price) return 0;
  return Math.round((1 - price / compare) * 100);
}

function renderThumb(p) {
  const img = safeUrl(p.image);
  if (img) return `<img src="${esc(img)}" alt="" loading="lazy" decoding="async">`;
  return `<span class="emoji" aria-hidden="true">${esc(p.emoji || initials(p.name))}</span>`;
}

function renderProduct(p, s, t, extraClass = '') {
  const soldOut = !p.available;
  const off = discountPercent(p);
  const compare = off ? `<s class="compare">${esc(formatMoney(p.comparePrice, s.currency))}</s>` : '';
  const search = `${p.name} ${p.description || ''}`.toLowerCase();
  const badges = [
    p.featured ? `<span class="badge hot">${icon('star', 'i xs')}${esc(t.featured)}</span>` : '',
    off ? `<span class="badge sale">−${off}%</span>` : '',
  ].join('');
  return `<article class="card${soldOut ? ' soldout' : ''}${extraClass}" data-id="${esc(p.id)}" data-search="${esc(search)}" style="--h:${hueFor(p.name)}" tabindex="0" role="button" aria-label="${esc(p.name)}">
  <div class="thumb${safeUrl(p.image) ? ' has-img' : ''}">${renderThumb(p)}</div>
  <div class="info">
    ${badges ? `<div class="badges">${badges}</div>` : ''}
    <h3>${esc(p.name)}</h3>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    <div class="price-row"><span class="price">${esc(productPriceLabel(p, s.currency, t))}</span>${compare}${soldOut ? `<span class="soldout-tag">${esc(t.soldOut)}</span>` : ''}</div>
  </div>
  ${soldOut ? '' : `<button class="add" type="button" aria-label="${esc(t.add)}" data-add="${esc(p.id)}">${icon('plus')}</button>`}
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
  preview = false,
  languages = [],
}) {
  const t = strings(lang);
  const color = safeColor(s.color);
  const cover = safeUrl(s.cover);
  const logo = safeUrl(s.logo);
  const theme = cleanTheme(s.theme);

  const sections = [];
  const catIds = new Set(categories.map((c) => c.id));
  for (const c of categories) {
    const items = products.filter((p) => p.categoryId === c.id);
    if (items.length) sections.push({ id: c.id, name: c.name, items });
  }
  const loose = products.filter((p) => !catIds.has(p.categoryId));
  if (loose.length) sections.push({ id: 'other', name: sections.length ? '…' : '', items: loose });
  const featured = products.filter((p) => p.featured && p.available);

  const langMenu = languages.length > 1
    ? `<label class="lang">${icon('globe')}<select id="lang" aria-label="${esc(t.language)}">${languages
        .map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`)
        .join('')}</select></label>`
    : '';

  let closedText = '';
  if (!canOrder) {
    closedText = closedBySchedule
      ? `${t.closedNow}${opensAt ? ` · ${t.opensAt.replace('{time}', opensAt)}` : ''}`
      : s.closedMessage || t.closed;
  }
  const statusText = canOrder ? `${t.openNow}${s.hours ? ` · ${s.hours}` : ''}` : closedText;
  const methods = enabledMethods(s);
  const digits = String(s.whatsapp || '').replace(/\D/g, '');
  const mapUrl = safeUrl(s.mapUrl);

  const quick = [
    digits && `<a class="qa wa" href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>`,
    s.phone && `<a class="qa" href="tel:${esc(s.phone)}" aria-label="${esc(t.call)}">${icon('phone')}</a>`,
    mapUrl && `<a class="qa" href="${esc(mapUrl)}" target="_blank" rel="noopener" aria-label="${esc(t.directions)}">${icon('pin')}</a>`,
    s.instagram && `<a class="qa" href="${esc(socialUrl('instagram', s.instagram))}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>`,
    s.facebook && `<a class="qa" href="${esc(socialUrl('facebook', s.facebook))}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>`,
    s.tiktok && `<a class="qa" href="${esc(socialUrl('tiktok', s.tiktok))}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>`,
    `<button class="qa" type="button" id="share" aria-label="${esc(t.share)}">${icon('share')}</button>`,
  ].filter(Boolean);

  const zones = s.delivery ? s.zones || [] : [];
  const fee = Number(s.deliveryFee) || 0;
  const facts = [
    table && `<span class="fact strong">${icon('chair')}${esc(t.yourTable)} ${esc(table)}</span>`,
    s.delivery && !zones.length && `<span class="fact">${icon('truck')}${esc(t.deliveryFee)} ${esc(fee ? formatMoney(fee, s.currency) : t.free)}</span>`,
    s.delivery && Number(s.freeDeliveryOver) > 0 && `<span class="fact">${icon('tag')}${esc(t.freeDeliveryOver)} ${esc(formatMoney(s.freeDeliveryOver, s.currency))}</span>`,
    Number(s.minOrder) > 0 && `<span class="fact">${icon('bag')}${esc(t.minOrder)} ${esc(formatMoney(s.minOrder, s.currency))}</span>`,
    methods.includes('pickup') && `<span class="fact">${icon('store')}${esc(t.pickup)}</span>`,
  ].filter(Boolean);

  const clientData = {
    lang,
    t,
    table: table || '',
    icons: ICONS,
    preview,
    shop: {
      name: s.name,
      currency: s.currency,
      deliveryFee: fee,
      freeDeliveryOver: Number(s.freeDeliveryOver) || 0,
      minOrder: Number(s.minOrder) || 0,
      methods,
      acceptingOrders: canOrder,
      closedText,
      zones: zones.map((z) => ({ id: z.id, name: z.name, fee: Number(z.fee) || 0 })),
      hasCoupons,
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: Number(p.price) || 0,
      comparePrice: Number(p.comparePrice) || 0,
      image: safeUrl(p.image),
      emoji: p.emoji || '',
      hue: hueFor(p.name),
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
${preview ? '<meta name="robots" content="noindex">' : languages.map((l) => `<link rel="alternate" hreflang="${esc(l.code)}" href="${esc(baseUrl)}?lang=${esc(l.code)}">`).join('\n')}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${logo ? esc(logo) : '/img/icon.svg'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" id="font-css" href="${esc(fontHref(s.font, lang))}">
<link rel="stylesheet" href="/css/store.css?v=${VERSION}">
<style id="vars">:root{--brand:${color};--font:${fontStack(s.font)}}</style>
<script type="application/ld+json">${inlineJson(jsonLd)}</script>
</head>
<body class="theme-${theme}${canOrder ? '' : ' is-closed'}">
<header class="hero">
  <div class="cover${cover ? ' has-img' : ''}" id="cover">${cover ? `<img src="${esc(cover)}" alt="" fetchpriority="high">` : ''}
    <div class="topbar">${langMenu}</div>
  </div>
  <div class="shop-card">
    <div class="logo" id="logo">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}</div>
    <div class="shop-main">
      <h1>${esc(s.name)}</h1>
      ${s.tagline ? `<p class="tagline">${esc(s.tagline)}</p>` : ''}
      <p class="status ${canOrder ? 'open' : 'closed'}" role="status"><span class="dot"></span>${esc(statusText)}</p>
    </div>
    <div class="quick">${quick.join('')}</div>
    ${facts.length ? `<div class="facts">${facts.join('')}</div>` : ''}
  </div>
</header>
${demo ? `<div class="notice demo" role="note">${icon('sparkles')}<span>${esc(t.demoBanner)}</span></div>` : ''}
<nav class="toolbar" aria-label="Menu">
  <div class="search">${icon('search')}<input id="q" type="search" placeholder="${esc(t.search)}" autocomplete="off" aria-label="${esc(t.search)}"></div>
  ${sections.length > 1 ? `<div class="chips" id="chips">${sections
    .map((sec, i) => `<a href="#cat-${esc(sec.id)}" class="chip${i === 0 ? ' active' : ''}" data-cat="${esc(sec.id)}">${esc(sec.name)}</a>`)
    .join('')}</div>` : ''}
</nav>
<main id="menu">
${featured.length >= 2 ? `<section class="featured" id="featured" aria-label="${esc(t.featured)}">
  <h2>${icon('star')}${esc(t.featured)}</h2>
  <div class="rail">${featured.map((p) => renderProduct(p, s, t, ' feat')).join('')}</div>
</section>` : ''}
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
<p class="empty" id="no-results" hidden>${icon('search')}<br>${esc(t.noResults)}</p>
</main>
<footer class="footer">
  ${s.about || s.address ? `<div class="about-card">
    ${s.about ? `<p>${esc(s.about)}</p>` : ''}
    ${s.address ? `<p class="addr">${icon('pin')}${mapUrl ? `<a href="${esc(mapUrl)}" target="_blank" rel="noopener">${esc(s.address)}</a>` : esc(s.address)}</p>` : ''}
    ${s.hours ? `<p class="addr">${icon('clock')}${esc(s.hours)}</p>` : ''}
  </div>` : ''}
  <p class="powered">${esc(t.poweredBy)} <a href="https://github.com/mashraf1997/dukkan" target="_blank" rel="noopener">Dukkan</a></p>
</footer>

<div class="cartbar" id="cartbar" hidden>
  <button type="button" id="open-cart"><span class="bag">${icon('bag')}<span class="count" id="cart-count">0</span></span><span class="label">${esc(t.viewCart)}</span><span class="sum" id="cart-sum"></span></button>
</div>

<div class="sheet" id="sheet" hidden>
  <div class="backdrop" data-close></div>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <div class="grab" aria-hidden="true"></div>
    <button class="close" type="button" data-close aria-label="Close">${icon('x')}</button>
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
  const logo = safeUrl(s.logo);
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<title>QR — ${esc(s.name)}</title>
<link rel="stylesheet" href="${esc(fontHref(s.font, lang))}">
<style>
  *{box-sizing:border-box}
  body{font-family:${fontStack(s.font)};margin:0;padding:24px;color:#111;background:#f4f4f1}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
  .poster{background:#fff;border-radius:24px;overflow:hidden;text-align:center;break-inside:avoid;page-break-inside:avoid;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  .poster .top{background:${color};color:#fff;padding:20px 16px 46px}
  .poster .logo{width:56px;height:56px;border-radius:16px;background:#fff;color:${color};display:grid;place-items:center;margin:0 auto 8px;font-weight:800;font-size:24px;overflow:hidden}
  .poster .logo img{width:100%;height:100%;object-fit:cover}
  .poster h2{margin:0;font-size:22px}
  .poster .qr{background:#fff;margin:-34px auto 0;width:210px;padding:12px;border-radius:20px;box-shadow:0 6px 20px rgba(0,0,0,.12)}
  .poster .qr svg{width:100%;height:auto;display:block}
  .poster p{margin:14px 0 4px;color:${color};font-weight:800;font-size:18px}
  .poster .label{display:inline-block;margin:6px 0 18px;background:#111;color:#fff;border-radius:999px;padding:4px 18px;font-weight:800}
  .poster .sp{height:18px}
  .bar{margin-bottom:20px;display:flex;gap:12px}
  .bar button{font:inherit;font-weight:700;padding:10px 20px;border-radius:12px;border:0;background:${color};color:#fff;cursor:pointer}
  @media print{.bar{display:none}body{padding:0;background:#fff}.poster{box-shadow:none;border:1px solid #ddd}}
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()">Print</button></div>
<div class="grid">
${items
  .map(
    (i) => `<div class="poster"><div class="top"><div class="logo">${logo ? `<img src="${esc(logo)}" alt="">` : esc(initials(s.name))}</div><h2>${esc(s.name)}</h2></div><div class="qr">${i.svg}</div><p>${esc(t.scanToOrder)}</p>${i.label ? `<div class="label">${esc(i.label)}</div>` : '<div class="sp"></div>'}</div>`
  )
  .join('\n')}
</div>
</body>
</html>`;
}

/** 80mm thermal-printer receipt for one order. */
function renderReceipt({ settings: s, order: o, lang }) {
  const t = strings(lang);
  const cur = s.currency;
  const when = new Date(o.createdAt).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const row = (a, b, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<title>#${esc(o.no)} — ${esc(s.name)}</title>
<style>
  @page{size:80mm auto;margin:4mm}
  *{box-sizing:border-box}
  body{font-family:ui-monospace,'Courier New',${fontStack(s.font)};width:72mm;margin:0 auto;padding:8px 0;color:#000;font-size:13px;line-height:1.45}
  h1{font-size:18px;text-align:center;margin:0}
  .c{text-align:center}
  .no{font-size:22px;font-weight:800;text-align:center;margin:6px 0}
  hr{border:0;border-top:1px dashed #000;margin:8px 0}
  .row{display:flex;justify-content:space-between;gap:8px}
  .row span:last-child{white-space:nowrap}
  .big{font-size:16px;font-weight:800}
  .muted{color:#333;font-size:12px}
  .bar{position:fixed;top:8px;inset-inline-end:8px}
  .bar button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #000;background:#fff;cursor:pointer}
  @media print{.bar{display:none}}
</style>
</head>
<body>
<div class="bar"><button onclick="window.print()">Print</button></div>
<h1>${esc(s.name)}</h1>
${s.phone ? `<div class="c muted">${esc(s.phone)}</div>` : ''}
<div class="no">#${esc(o.no)}</div>
<div class="c muted">${esc(when)}</div>
<div class="c"><b>${esc(t[o.method])}${o.table ? ` · ${esc(t.msgTable)} ${esc(o.table)}` : ''}</b></div>
<hr>
${o.items
  .map(
    (i) => `<div class="row"><span>${i.qty}× ${esc(i.name)}${i.variant ? ` (${esc(i.variant)})` : ''}</span><span>${esc(formatMoney(i.price * i.qty, cur))}</span></div>`
  )
  .join('')}
<hr>
${row(esc(t.subtotal), esc(formatMoney(o.subtotal, cur)))}
${o.discount ? row(`${esc(t.discount)} (${esc(o.coupon)})`, `-${esc(formatMoney(o.discount, cur))}`) : ''}
${o.method === 'delivery' ? row(`${esc(t.deliveryFee)}${o.zone ? ` · ${esc(o.zone)}` : ''}`, esc(o.deliveryFee ? formatMoney(o.deliveryFee, cur) : t.free)) : ''}
${row(esc(t.total), esc(formatMoney(o.total, cur)), 'big')}
<hr>
<div>${esc(t.msgCustomer)}: <b>${esc(o.customer.name)}</b></div>
${o.customer.phone ? `<div>${esc(t.msgPhone)}: ${esc(o.customer.phone)}</div>` : ''}
${o.customer.address ? `<div>${esc(t.msgAddress)}: ${esc(o.customer.address)}</div>` : ''}
${o.customer.notes ? `<div>${esc(t.msgNotes)}: ${esc(o.customer.notes)}</div>` : ''}
<hr>
<div class="c muted">Dukkan</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300))</script>
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

module.exports = { renderStore, renderQrPrint, renderReceipt, renderManifest, esc, safeColor, safeUrl };
