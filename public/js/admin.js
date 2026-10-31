(() => {
  'use strict';

  // ======================= i18n =======================
  // Strings come from /locales/<lang>.json via the server.
  const LANG_KEY = 'dukkan-admin-lang';
  let lang = (() => {
    try { return localStorage.getItem(LANG_KEY); } catch { return null; }
  })();
  let S = {};
  let LANGUAGES = [{ code: 'en', name: 'English' }];
  const T = (k) => S[k] || k;

  async function setLang(next) {
    const res = await fetch(`/api/i18n/${encodeURIComponent(next || 'en')}`);
    const data = await res.json();
    S = data.strings;
    LANGUAGES = data.languages;
    lang = LANGUAGES.some((l) => l.code === next) ? next : 'en';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = T('dir');
  }

  // ======================= helpers =======================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Dukkan': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !url.endsWith('/login') && !url.endsWith('/password')) {
      boot();
      throw new Error('unauthorized');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
    return data;
  }

  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
  const money = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const str = Number.isInteger(v) ? String(v) : v.toFixed(2);
    const cur = state.data ? state.data.settings.currency : '';
    return PREFIX.includes(cur) ? `${cur}${str}` : `${str} ${cur}`.trim();
  };

  function timeAgo(iso) {
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (s < 60) return rtf.format(-s, 'second');
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  }

  const sw = (name, checked, label) =>
    `<label class="check"><span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><i></i></span><span>${label}</span></label>`;

  // Downscale photos in the browser so uploads are small and fast.
  async function fileToDataUrl(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.85);
      return data;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadFile(file, max = 1200) {
    toast(T('uploading'));
    const dataUrl = await fileToDataUrl(file, max);
    const { url } = await api('POST', '/api/admin/upload', { dataUrl });
    return url;
  }

  // ======================= state =======================
  const state = { data: null, stats: null, orders: null, counts: null, tab: 'home', filter: '', lastNew: null };

  async function loadData() {
    state.data = await api('GET', '/api/admin/data');
    document.documentElement.style.setProperty('--brand', state.data.settings.color);
  }

  // ======================= boot / auth =======================
  let demo = null;

  async function boot() {
    let s;
    try {
      s = await api('GET', '/api/state');
    } catch {
      app.innerHTML = `<div class="auth"><div class="auth-card"><p class="error">Error</p></div></div>`;
      return;
    }
    demo = s.demo;
    await setLang(lang || s.lang);
    if (!s.setupDone) return renderSetup(s);
    if (!s.authed) return renderLogin();
    await loadData();
    renderShell();
    startPolling();
  }

  const langSwitch = () =>
    `<select class="lang-select" data-act-change="lang" aria-label="Language">${LANGUAGES.map(
      (l) => `<option value="${esc(l.code)}" ${l.code === lang ? 'selected' : ''}>${esc(l.name)}</option>`
    ).join('')}</select>`;

  const langOptions = (selected) =>
    LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('');

  const CURRENCY_GUESS = { ar: 'EGP', en: 'USD', es: 'MXN', pt: 'BRL', fr: 'EUR', tr: 'TRY', id: 'IDR', hi: 'INR' };
  const browserTimezone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  };

  function renderSetup(s) {
    app.innerHTML = `
      <div class="auth"><form class="auth-card" id="setup" autocomplete="off">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('setupTitle'))}</h1>
        <p class="sub">${esc(T('setupSub'))}</p>
        ${s.needsSetupCode ? `<label class="field"><span>🔑 ${esc(T('setupCode'))}</span><input name="setupCode" required maxlength="12" placeholder="ABCD-EFGH" autocapitalize="characters" spellcheck="false" style="letter-spacing:.15em;font-weight:700"><small>${esc(T('setupCodeHint'))}</small></label>` : ''}
        <label class="field"><span>${esc(T('shopName'))}</span><input name="name" required maxlength="80"></label>
        <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" inputmode="tel" maxlength="20" placeholder="201001234567"><small>${esc(T('whatsappHint'))}</small></label>
        <div class="grid2">
          <label class="field"><span>${esc(T('currency'))}</span><input name="currency" list="currencies" value="${CURRENCY_GUESS[lang] || 'USD'}" maxlength="12"></label>
          <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(lang)}</select></label>
        </div>
        <datalist id="currencies">${['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'MAD', 'TND', 'DZD', 'IQD', 'LBP', 'USD', 'EUR', 'GBP', 'TRY', 'INR', 'PKR', 'IDR', 'BRL', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'XOF', 'NGN', 'PHP', 'MYR', '$', '€', '£', '₹', 'R$', 'ج.م', 'ر.س', 'د.إ'].map((c) => `<option value="${c}">`).join('')}</datalist>
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required minlength="8" autocomplete="new-password"><small>${esc(T('passwordHint'))}</small></label>
        ${sw('sample', true, `${esc(T('sampleMenu'))} <small class="muted">— ${esc(T('sampleHint'))}</small>`)}
        <button class="btn block" type="submit">${esc(T('openShop'))}</button>
        <p class="error" id="err"></p>
      </form></div>`;
    const f = $('#setup');
    (f.setupCode || f.name).focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (f.password.value.length < 8) return ($('#err').textContent = T('weakPassword'));
      f.querySelector('button[type=submit]').disabled = true;
      try {
        await api('POST', '/api/setup', {
          setupCode: f.setupCode ? f.setupCode.value : '',
          name: f.name.value, whatsapp: f.whatsapp.value, currency: f.currency.value,
          lang: f.lang.value, password: f.password.value, sample: f.sample.checked,
          timezone: browserTimezone(),
        });
        await setLang(f.lang.value);
        boot();
      } catch (err) {
        const msg = { weak_password: 'weakPassword', invalid_setup_code: 'invalidSetupCode', rate_limited: 'rateLimited' }[err.code];
        $('#err').textContent = T(msg || 'error');
        f.querySelector('button[type=submit]').disabled = false;
      }
    });
  }

  function renderLogin() {
    app.innerHTML = `
      <div class="auth"><form class="auth-card" id="login">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('loginTitle'))}</h1>
        <p class="sub">${esc(T('loginSub'))}</p>
        ${demo ? `<p class="demo-note">🧪 ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></p>` : ''}
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required autocomplete="current-password" value="${demo ? esc(demo.password) : ''}"></label>
        <button class="btn block" type="submit">${esc(T('login'))}</button>
        <p class="error" id="err"></p>
      </form></div>`;
    $('#login [name=password]').focus();
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/login', { password: e.target.password.value });
        boot();
      } catch (err) {
        $('#err').textContent = err.code === 'rate_limited' ? T('rateLimited') : T('wrongPassword');
      }
    });
  }

  // ======================= shell =======================
  const TABS = [
    ['home', '📊'], ['orders', '🧾'], ['menu', '🍽️'], ['share', '📣'], ['settings', '⚙️'],
  ];

  function renderShell() {
    const s = state.data.settings;
    const hash = location.hash.slice(1);
    if (TABS.some(([k]) => k === hash)) state.tab = hash;
    const open = state.data.open;
    app.innerHTML = `
      ${demo ? `<div class="demo-bar">🧪 ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></div>` : ''}
      <header class="top">
        <img src="${esc(s.logo || '/img/icon.svg')}" alt="" width="36" height="36" style="border-radius:10px;object-fit:cover">
        <div class="shop">${esc(s.name)}<small class="muted"><span class="status-dot ${open ? '' : 'off'}"></span>${esc(open ? T('open') : T('closed'))}</small></div>
        ${langSwitch()}
        <a class="btn sm" href="/" target="_blank" rel="noopener">${esc(T('viewStore'))} ↗</a>
        <button class="icon-btn" data-act="logout" title="${esc(T('logout'))}" aria-label="${esc(T('logout'))}" type="button">🚪</button>
      </header>
      <div class="layout">
        <nav class="nav">${TABS.map(([k, ico]) => `<button type="button" data-tab="${k}" class="${state.tab === k ? 'active' : ''}"><span class="ico">${ico}</span><span>${esc(T(k))}</span>${k === 'orders' ? '<span class="dot" id="new-dot" hidden></span>' : ''}</button>`).join('')}</nav>
        <main class="view" id="view"></main>
      </div>`;
    updateNewDot();
    renderTab();
  }

  function updateNewDot() {
    const dot = $('#new-dot');
    const n = state.counts ? state.counts.new : 0;
    if (dot) {
      dot.hidden = !n;
      dot.textContent = n;
    }
    document.title = `${n ? `(${n}) ` : ''}Dukkan — ${state.data ? state.data.settings.name : ''}`;
  }

  async function renderTab() {
    $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    const view = $('#view');
    if (!view) return;
    try {
      await VIEWS[state.tab](view);
    } catch (err) {
      if (err.message !== 'unauthorized') {
        console.error(err);
        toast(T('error'), true);
      }
    }
  }

  // ======================= views =======================
  const VIEWS = {};

  VIEWS.home = async (view) => {
    const st = (state.stats = await api('GET', '/api/admin/stats'));
    const s = state.data.settings;
    const link = state.data.baseUrl;
    const maxDay = Math.max(1, ...st.days.map((d) => d.orders));
    const steps = [
      [!!s.whatsapp, T('stepWhatsapp'), 'settings'],
      [st.products > 0, T('stepProducts'), 'menu'],
      [!!s.logo, T('stepLogo'), 'settings'],
      [st.month.orders > 0, T('stepShare'), 'share'],
    ];
    const allDone = demo || steps.every((x) => x[0]);
    view.innerHTML = `
      <h2 class="title">${esc(T('home'))}</h2>
      <div class="card big-toggle">
        <div class="txt"><b>${esc(T('accepting'))}</b><span class="muted small">${esc(!s.acceptingOrders ? T('acceptingOff') : state.data.open ? T('acceptingOn') : T('closedBySchedule'))}</span></div>
        <label class="switch"><input type="checkbox" id="accepting" ${s.acceptingOrders ? 'checked' : ''}><i></i></label>
      </div>
      <div class="stats">
        <div class="stat"><div class="label">${esc(T('today'))}</div><div class="value">${st.today.orders} <small>${esc(money(st.today.revenue))}</small></div></div>
        <div class="stat"><div class="label">${esc(T('visitors'))}</div><div class="value">${st.visits.month} <small>${st.visits.today} ${esc(T('visitorsToday'))}</small></div><div class="muted small">${esc(T('conversion'))}: <b>${st.visits.conversion}%</b> ${esc(T('conversionHint'))}</div></div>
        <div class="stat"><div class="label">${esc(T('month'))}</div><div class="value" style="font-size:22px">${esc(money(st.month.revenue))}</div></div>
        <div class="stat"><div class="label">${esc(T('avgOrder'))}</div><div class="value" style="font-size:22px">${esc(money(st.month.avg))}</div></div>
      </div>
      <div class="dash-cols">
        <div>
          <div class="card">
            <h3>${esc(T('last14'))}</h3>
            <div class="bars">${st.days.map((d) => `<div style="height:${(d.orders / maxDay) * 100}%" title="${d.date}: ${d.orders} · ${esc(money(d.revenue))}"></div>`).join('')}</div>
            <div class="bars-x"><span>${st.days[0].date.slice(5)}</span><span>${st.days[13].date.slice(5)}</span></div>
          </div>
          <div class="card">
            <h3>${esc(T('topProducts'))}</h3>
            ${st.top.length ? `<ul class="top-list">${st.top.map((p) => `<li><span>${esc(p.name)}</span><b>× ${p.qty}</b></li>`).join('')}</ul>` : `<p class="muted">${esc(T('noData'))}</p>`}
          </div>
        </div>
        <div>
          ${allDone ? '' : `<div class="card"><h3>🚀 ${esc(T('getStarted'))}</h3><ul class="checklist">${steps.map(([done, label, tab]) => `<li class="${done ? 'done' : ''}">${done ? '✅' : '⬜'} ${done ? esc(label) : `<a href="#${tab}" data-tab="${tab}">${esc(label)}</a>`}</li>`).join('')}</ul></div>`}
          <div class="card">
            <h3>🔗 ${esc(T('yourLink'))}</h3>
            <div class="share-row"><input class="input" readonly value="${esc(link)}" id="link"><button class="btn sm" data-act="copy" data-text="${esc(link)}" type="button">${esc(T('copy'))}</button></div>
            <div style="text-align:center;margin-top:14px"><img src="/api/admin/qr.svg?text=${encodeURIComponent(link)}" alt="QR" width="160" height="160" style="border-radius:12px;background:#fff;padding:6px"></div>
          </div>
        </div>
      </div>`;
    $('#accepting').addEventListener('change', async (e) => {
      const { settings, open } = await api('PUT', '/api/admin/settings', { acceptingOrders: e.target.checked });
      state.data.settings = settings;
      state.data.open = open;
      renderShell();
    });
  };

  VIEWS.orders = async (view) => {
    const q = state.filter ? `?status=${state.filter}` : '';
    const { orders, counts } = await api('GET', `/api/admin/orders${q}`);
    state.counts = counts;
    updateNewDot();
    const filters = ['', 'new', 'confirmed', 'completed', 'cancelled'];
    view.innerHTML = `
      <h2 class="title">${esc(T('orders'))}</h2>
      <div class="filters">${filters.map((f) => `<button type="button" data-filter="${f}" class="${state.filter === f ? 'active' : ''}">${esc(f ? T(`st_${f}`) : T('all'))} · ${f ? counts[f] : counts.all}</button>`).join('')}</div>
      ${orders.length ? orders.map(orderCard).join('') : `<div class="card empty-state"><div class="big">🧾</div><p>${esc(T('noOrders'))}</p></div>`}`;
  };

  function orderCard(o) {
    const phone = String(o.customer.phone || '').replace(/[^\d]/g, '');
    const next = {
      new: [['confirmed', T('markConfirmed'), ''], ['cancelled', T('markCancelled'), 'danger']],
      confirmed: [['completed', T('markCompleted'), ''], ['cancelled', T('markCancelled'), 'danger']],
      completed: [['new', T('reopen'), 'line']],
      cancelled: [['new', T('reopen'), 'line']],
    }[o.status] || [];
    return `<div class="card order s-${o.status}">
      <div class="order-head">
        <span class="no">#${o.no}</span><span class="tag ${o.status}">${esc(T(`st_${o.status}`))}</span>
        <span class="tag">${{ delivery: '🚚', pickup: '🛍️', dineIn: '🍽️' }[o.method]} ${esc(T(o.method))}${o.table ? ` · ${esc(T('table'))} ${esc(o.table)}` : ''}</span>
        <span class="muted small" style="margin-inline-start:auto">${esc(timeAgo(o.createdAt))}</span>
      </div>
      <div class="kv">
        <div>👤 <b>${esc(o.customer.name)}</b>${o.customer.phone ? ` · <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a>` : ''}</div>
        ${o.customer.address ? `<div>📍 ${o.zone ? `<b>${esc(o.zone)}</b> · ` : ''}${esc(o.customer.address)}</div>` : ''}
        ${o.customer.notes ? `<div>📝 ${esc(o.customer.notes)}</div>` : ''}
      </div>
      <ul class="order-items">${o.items.map((i) => `<li><span>${i.qty}× ${esc(i.name)}${i.variant ? ` <span class="muted">(${esc(i.variant)})</span>` : ''}</span><span>${esc(money(i.price * i.qty))}</span></li>`).join('')}
        ${o.discount ? `<li class="muted"><span>${esc(T('discount'))} (${esc(o.coupon)})</span><span>−${esc(money(o.discount))}</span></li>` : ''}
        ${o.deliveryFee ? `<li class="muted"><span>${esc(T('deliveryFee'))}${o.zone ? ` · ${esc(o.zone)}` : ''}</span><span>${esc(money(o.deliveryFee))}</span></li>` : ''}</ul>
      <div class="order-foot">
        <span class="total">${esc(T('total'))}: ${esc(money(o.total))}</span>
        ${phone ? `<a class="btn sm wa" href="https://wa.me/${phone}" target="_blank" rel="noopener">💬 ${esc(T('chatCustomer'))}</a>` : ''}
        ${next.map(([st, label, cls]) => `<button type="button" class="btn sm ${cls}" data-order="${o.id}" data-status="${st}">${esc(label)}</button>`).join('')}
      </div>
    </div>`;
  }

  VIEWS.menu = async (view) => {
    const { categories, products } = state.data;
    const groups = categories.map((c) => ({ c, items: products.filter((p) => p.categoryId === c.id) }));
    const loose = products.filter((p) => !categories.some((c) => c.id === p.categoryId));
    if (loose.length) groups.push({ c: { id: '', name: T('uncategorized') }, items: loose });

    view.innerHTML = `
      <h2 class="title">${esc(T('menu'))}<span class="spacer"></span><button class="btn" data-act="new-product" type="button">+ ${esc(T('addProduct'))}</button></h2>
      <div class="card">
        <h3>${esc(T('categories'))}</h3>
        ${categories.length ? '' : `<p class="muted small">${esc(T('noCategories'))}</p>`}
        ${categories.map((c, i) => `<div class="cat-row">
          <span class="name">${esc(c.name)} <span class="muted small">(${products.filter((p) => p.categoryId === c.id).length})</span></span>
          <button class="icon-btn" data-move="categories" data-id="${c.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="${esc(T('up'))}">↑</button>
          <button class="icon-btn" data-move="categories" data-id="${c.id}" data-dir="1" ${i === categories.length - 1 ? 'disabled' : ''} title="${esc(T('down'))}">↓</button>
          <button class="icon-btn" data-act="rename-cat" data-id="${c.id}" title="${esc(T('edit'))}">✏️</button>
          <button class="icon-btn" data-act="del-cat" data-id="${c.id}" title="${esc(T('del'))}">🗑</button>
        </div>`).join('')}
        <form id="add-cat" class="share-row" style="margin-top:12px"><input class="input" name="name" placeholder="${esc(T('categoryName'))}" maxlength="60" required><button class="btn" type="submit">${esc(T('add'))}</button></form>
      </div>
      <div class="card">
        <h3>${esc(T('products'))}</h3>
        ${products.length ? groups.filter((g) => g.items.length).map((g) => `
          <div class="group-title">${esc(g.c.name)}</div>
          ${g.items.map((p, i) => `<div class="prod-row ${p.available ? '' : 'off'}">
            <div class="pthumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : esc(p.emoji || p.name.charAt(0))}</div>
            <div class="name">${p.featured ? '⭐ ' : ''}${esc(p.name)}<small>${p.variants && p.variants.length ? p.variants.map((v) => `${esc(v.name)} ${esc(money(v.price))}`).join(' · ') : esc(money(p.price))}</small></div>
            <label class="switch" title="${esc(T('available'))}"><input type="checkbox" data-avail="${p.id}" ${p.available ? 'checked' : ''}><i></i></label>
            <button class="icon-btn" data-move="products" data-id="${p.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="${esc(T('up'))}">↑</button>
            <button class="icon-btn" data-act="edit-product" data-id="${p.id}" title="${esc(T('edit'))}">✏️</button>
          </div>`).join('')}`).join('') : `<div class="empty-state"><div class="big">🍽️</div><p>${esc(T('noProductsYet'))}</p><button class="btn" data-act="new-product" type="button">+ ${esc(T('addProduct'))}</button></div>`}
      </div>
      <div class="card">
        <h3>📄 ${esc(T('csvTitle'))}</h3>
        <p class="muted small">${esc(T('csvHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a class="btn line sm" href="/api/admin/products-template.csv" download>${esc(T('csvTemplate'))}</a>
          <a class="btn line sm" href="/api/admin/products.csv" download>${esc(T('csvExport'))}</a>
          <label class="btn sm" style="cursor:pointer">${esc(T('csvImport'))}<input type="file" accept=".csv,text/csv" id="csv-file" hidden></label>
        </div>
        <div style="margin-top:12px">${sw('csvReplace', false, esc(T('csvReplace')))}</div>
      </div>`;

    $('#add-cat').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cat = await api('POST', '/api/admin/categories', { name: e.target.name.value });
      state.data.categories.push(cat);
      renderTab();
    });

    $('#csv-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const replace = $('[name=csvReplace]', view).checked;
      if (replace && !confirm(T('importConfirm'))) return;
      try {
        const { imported } = await api('POST', '/api/admin/products/csv', { csv: await file.text(), replace });
        await loadData();
        toast(T('csvImported').replace('{n}', imported));
        renderTab();
      } catch {
        toast(T('csvError'), true);
      }
      e.target.value = '';
    });
  };

  function productModal(p) {
    const isNew = !p;
    p = p || { name: '', description: '', price: '', comparePrice: '', image: '', emoji: '', categoryId: state.data.categories[0] ? state.data.categories[0].id : '', available: true, featured: false, variants: [] };
    let image = p.image;
    const variantRow = (v = { name: '', price: '' }) => `<div class="vrow"><input class="input" data-vname placeholder="${esc(T('variantName'))}" value="${esc(v.name)}" maxlength="60"><input class="input price" data-vprice type="number" min="0" step="any" placeholder="${esc(T('price'))}" value="${esc(v.price)}"><button type="button" class="icon-btn" data-vdel>✕</button></div>`;

    const box = openModal(`
      <h3>${esc(isNew ? T('addProduct') : T('editProduct'))}</h3>
      <form id="pform">
        <label class="field"><span>${esc(T('name'))} *</span><input name="name" required maxlength="100" value="${esc(p.name)}"></label>
        <div class="field"><span>${esc(T('image'))}</span>
          <div class="img-pick">
            <div class="preview" id="pimg"></div>
            <div style="display:grid;gap:6px;flex:1">
              <label class="btn sm line" style="cursor:pointer">📷 ${esc(T('uploadImage'))}<input type="file" accept="image/*" id="pfile" hidden></label>
              <button type="button" class="btn sm ghost" id="pimg-rm">${esc(T('removeImage'))}</button>
              <input class="input" name="emoji" maxlength="8" placeholder="${esc(T('orEmoji'))} 🍕" value="${esc(p.emoji)}" style="padding:6px 12px">
            </div>
          </div>
        </div>
        <div class="grid2">
          <label class="field"><span>${esc(T('category'))}</span><select name="categoryId"><option value="">${esc(T('uncategorized'))}</option>${state.data.categories.map((c) => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(T('price'))}</span><input name="price" type="number" min="0" step="any" value="${esc(p.price)}"></label>
        </div>
        <label class="field"><span>${esc(T('description'))}</span><textarea name="description" rows="2" maxlength="600">${esc(p.description)}</textarea></label>
        <div class="field variants"><span>${esc(T('variants'))}</span><small style="margin:0 0 8px">${esc(T('variantsHint'))}</small>
          <div id="vlist">${(p.variants || []).map(variantRow).join('')}</div>
          <button type="button" class="btn sm ghost" id="vadd">${esc(T('addVariant'))}</button>
        </div>
        <label class="field"><span>${esc(T('comparePrice'))}</span><input name="comparePrice" type="number" min="0" step="any" value="${esc(p.comparePrice || '')}"><small>${esc(T('comparePriceHint'))}</small></label>
        ${sw('available', p.available, esc(T('available')))}
        ${sw('featured', p.featured, esc(T('featured')))}
        <div class="modal-actions">
          <button class="btn" type="submit">${esc(T('save'))}</button>
          ${isNew ? '' : `<button class="btn danger" type="button" id="pdel">${esc(T('del'))}</button>`}
          <button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button>
        </div>
      </form>`);

    const form = $('#pform', box);
    const preview = () => {
      $('#pimg', box).innerHTML = image ? `<img src="${esc(image)}" alt="">` : esc(form.emoji.value || '📷');
      $('#pimg-rm', box).hidden = !image;
    };
    form.emoji.addEventListener('input', preview);
    $('#pfile', box).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        image = await uploadFile(file);
        preview();
      } catch (err) {
        toast(err.code === 'too_large' ? T('tooLarge') : T('error'), true);
      }
    });
    $('#pimg-rm', box).addEventListener('click', () => { image = ''; preview(); });
    $('#vadd', box).addEventListener('click', () => {
      $('#vlist', box).insertAdjacentHTML('beforeend', variantRow());
      $('#vlist .vrow:last-child input', box).focus();
    });
    $('#vlist', box).addEventListener('click', (e) => {
      if (e.target.closest('[data-vdel]')) e.target.closest('.vrow').remove();
    });
    if (!isNew) {
      $('#pdel', box).addEventListener('click', async () => {
        if (!confirm(T('confirmDelete'))) return;
        await api('DELETE', `/api/admin/products/${p.id}`);
        await loadData();
        closeModal();
        renderTab();
      });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: form.name.value,
        description: form.description.value,
        price: form.price.value,
        comparePrice: form.comparePrice.value,
        categoryId: form.categoryId.value,
        emoji: form.emoji.value,
        image,
        available: form.available.checked,
        featured: form.featured.checked,
        variants: $$('.vrow', box).map((r) => ({ name: $('[data-vname]', r).value, price: $('[data-vprice]', r).value })),
      };
      try {
        await api(isNew ? 'POST' : 'PUT', isNew ? '/api/admin/products' : `/api/admin/products/${p.id}`, body);
        await loadData();
        closeModal();
        toast(T('saved'));
        renderTab();
      } catch {
        toast(T('error'), true);
      }
    });
    preview();
    form.name.focus();
  }

  const COLORS = ['#0f766e', '#16a34a', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#a16207', '#0e7490', '#111827'];

  const zoneRow = (z = { id: '', name: '', fee: '' }) =>
    `<div class="vrow" data-zid="${esc(z.id)}"><input class="input" data-zname placeholder="${esc(T('zoneName'))}" value="${esc(z.name)}" maxlength="60"><input class="input price" data-zfee type="number" min="0" step="any" placeholder="${esc(T('fee'))}" value="${esc(z.fee)}"><button type="button" class="icon-btn" data-zdel>✕</button></div>`;

  // 2024-01-07 was a Sunday, so day i = Sunday + i.
  const dayName = (i) => new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));

  const timezones = () => {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return []; }
  };

  VIEWS.settings = async (view) => {
    const s = state.data.settings;
    let logo = s.logo;
    let cover = s.cover;
    view.innerHTML = `
      <h2 class="title">${esc(T('settings'))}</h2>
      <form id="sform">
        <div class="card">
          <h3>🏪 ${esc(T('storeInfo'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('shopName'))}</span><input name="name" maxlength="80" value="${esc(s.name)}"></label>
            <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(s.lang)}</select></label>
          </div>
          <label class="field"><span>${esc(T('tagline'))}</span><input name="tagline" maxlength="140" value="${esc(s.tagline)}"></label>
          <label class="field"><span>${esc(T('about'))}</span><textarea name="about" rows="2" maxlength="1000">${esc(s.about)}</textarea></label>
          <div class="grid2">
            <div class="field"><span>${esc(T('logo'))}</span><div class="img-pick"><div class="preview" id="logo-prev"></div><div style="display:grid;gap:6px"><label class="btn sm line" style="cursor:pointer">📷 ${esc(T('uploadImage'))}<input type="file" accept="image/*" id="logo-file" hidden></label><button type="button" class="btn sm ghost" id="logo-rm">${esc(T('removeImage'))}</button></div></div></div>
            <div class="field"><span>${esc(T('cover'))}</span><div class="img-pick"><div class="preview wide" id="cover-prev"></div><div style="display:grid;gap:6px"><label class="btn sm line" style="cursor:pointer">📷 ${esc(T('uploadImage'))}<input type="file" accept="image/*" id="cover-file" hidden></label><button type="button" class="btn sm ghost" id="cover-rm">${esc(T('removeImage'))}</button></div></div></div>
          </div>
          <div class="field"><span>${esc(T('brandColor'))}</span><div class="swatches" id="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" class="${c === s.color ? 'active' : ''}" aria-label="${c}"></button>`).join('')}<input type="color" name="color" value="${esc(s.color)}"></div></div>
        </div>

        <div class="card">
          <h3>🛵 ${esc(T('ordering'))}</h3>
          ${sw('acceptingOrders', s.acceptingOrders, esc(T('acceptingOrders')))}
          <label class="field"><span>${esc(T('closedMessage'))}</span><input name="closedMessage" maxlength="200" value="${esc(s.closedMessage)}" placeholder="${esc(T('closedMessagePh'))}"></label>
          <div class="grid2">
            <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" maxlength="20" value="${esc(s.whatsapp)}"><small>${esc(T('whatsappHint'))}</small></label>
            <label class="field"><span>${esc(T('currency'))}</span><input name="currency" maxlength="12" value="${esc(s.currency)}"></label>
          </div>
          ${sw('delivery', s.delivery, esc(T('deliveryOn')))}
          <div class="grid3">
            <label class="field"><span>${esc(T('deliveryFeeL'))}</span><input name="deliveryFee" type="number" min="0" step="any" value="${esc(s.deliveryFee)}"></label>
            <label class="field"><span>${esc(T('freeDeliveryOver'))}</span><input name="freeDeliveryOver" type="number" min="0" step="any" value="${esc(s.freeDeliveryOver)}"><small>${esc(T('freeHint'))}</small></label>
            <label class="field"><span>${esc(T('minOrder'))}</span><input name="minOrder" type="number" min="0" step="any" value="${esc(s.minOrder)}"><small>${esc(T('freeHint'))}</small></label>
          </div>
          <div class="field">
            <span>🗺️ ${esc(T('zones'))}</span>
            <small style="margin:0 0 8px">${esc(T('zonesHint'))}</small>
            <div id="zlist">${(s.zones || []).map(zoneRow).join('')}</div>
            <button type="button" class="btn sm ghost" id="zadd">${esc(T('addZone'))}</button>
          </div>
          ${sw('pickup', s.pickup, esc(T('pickupOn')))}
          ${sw('dineIn', s.dineIn, esc(T('dineInOn')))}
        </div>

        <div class="card">
          <h3>🕒 ${esc(T('schedule'))}</h3>
          <label class="check"><span class="switch"><input type="checkbox" id="sched-on" ${s.schedule.enabled ? 'checked' : ''}><i></i></span><span>${esc(T('scheduleOn'))}</span></label>
          <p class="muted small">${esc(T('scheduleHint'))}</p>
          <div id="sched" ${s.schedule.enabled ? '' : 'hidden'}>
            <div class="sched-grid">${s.schedule.days.map((d, i) => `<div class="sched-row" data-day="${i}">
              <span class="sched-day">${esc(dayName(i))}</span>
              <label class="switch"><input type="checkbox" data-open ${d.open ? 'checked' : ''}><i></i></label>
              <input type="time" class="input" data-from value="${esc(d.from)}" ${d.open ? '' : 'disabled'}>
              <span class="muted">→</span>
              <input type="time" class="input" data-to value="${esc(d.to)}" ${d.open ? '' : 'disabled'}>
            </div>`).join('')}</div>
            <label class="field" style="margin-top:12px"><span>${esc(T('timezone'))}</span><input id="sched-tz" list="tzlist" value="${esc(s.schedule.timezone || browserTimezone())}"></label>
            <datalist id="tzlist">${timezones().map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
          </div>
        </div>

        <div class="card">
          <h3>📞 ${esc(T('contact'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" maxlength="30" value="${esc(s.phone)}"></label>
            <label class="field"><span>${esc(T('hours'))}</span><input name="hours" maxlength="120" value="${esc(s.hours)}"></label>
            <label class="field"><span>${esc(T('addressL'))}</span><input name="address" maxlength="200" value="${esc(s.address)}"></label>
            <label class="field"><span>${esc(T('mapUrl'))}</span><input name="mapUrl" type="url" maxlength="500" value="${esc(s.mapUrl)}" placeholder="https://maps.app.goo.gl/…"></label>
          </div>
          <div class="grid3">
            <label class="field"><span>Instagram</span><input name="instagram" maxlength="200" value="${esc(s.instagram)}" placeholder="@yourshop"></label>
            <label class="field"><span>Facebook</span><input name="facebook" maxlength="200" value="${esc(s.facebook)}" placeholder="yourshop"></label>
            <label class="field"><span>TikTok</span><input name="tiktok" maxlength="200" value="${esc(s.tiktok)}" placeholder="@yourshop"></label>
          </div>
        </div>
        <div style="position:sticky;bottom:80px;z-index:5;margin-bottom:16px"><button class="btn block" type="submit">💾 ${esc(T('save'))}</button></div>
      </form>

      <div class="card">
        <h3>🔒 ${esc(T('security'))}</h3>
        <form id="pwform" class="grid2">
          <label class="field"><span>${esc(T('currentPassword'))}</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>${esc(T('newPassword'))}</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
          <div><button class="btn line" type="submit">${esc(T('changePassword'))}</button></div>
        </form>
      </div>
      <div class="card">
        <h3>💾 ${esc(T('backup'))}</h3>
        <p class="muted small">${esc(T('backupHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn line" href="/api/admin/export" download>${esc(T('exportData'))}</a>
          <label class="btn line" style="cursor:pointer">${esc(T('importData'))}<input type="file" accept="application/json,.json" id="import-file" hidden></label>
        </div>
      </div>`;

    const form = $('#sform');

    $('#zadd').addEventListener('click', () => {
      $('#zlist').insertAdjacentHTML('beforeend', zoneRow());
      $('#zlist .vrow:last-child input').focus();
    });
    $('#zlist').addEventListener('click', (e) => {
      if (e.target.closest('[data-zdel]')) e.target.closest('.vrow').remove();
    });
    $('#sched-on').addEventListener('change', (e) => ($('#sched').hidden = !e.target.checked));
    $('#sched').addEventListener('change', (e) => {
      if (e.target.matches('[data-open]')) {
        const row = e.target.closest('.sched-row');
        $$('input[type=time]', row).forEach((i) => (i.disabled = !e.target.checked));
      }
    });

    const showImgs = () => {
      $('#logo-prev').innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : '🏪';
      $('#cover-prev').innerHTML = cover ? `<img src="${esc(cover)}" alt="">` : '🖼️';
      $('#logo-rm').hidden = !logo;
      $('#cover-rm').hidden = !cover;
    };
    const pick = (input, max, set) =>
      $(input).addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          set(await uploadFile(f, max));
          showImgs();
        } catch {
          toast(T('error'), true);
        }
      });
    pick('#logo-file', 512, (u) => (logo = u));
    pick('#cover-file', 1600, (u) => (cover = u));
    $('#logo-rm').addEventListener('click', () => { logo = ''; showImgs(); });
    $('#cover-rm').addEventListener('click', () => { cover = ''; showImgs(); });
    showImgs();

    $('#swatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      form.color.value = b.dataset.color;
      $$('#swatches button').forEach((x) => x.classList.toggle('active', x === b));
      document.documentElement.style.setProperty('--brand', b.dataset.color);
    });
    form.color.addEventListener('input', () => document.documentElement.style.setProperty('--brand', form.color.value));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { logo, cover };
      for (const el of form.elements) {
        if (!el.name) continue;
        body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      body.zones = $$('#zlist .vrow').map((r) => ({ id: r.dataset.zid, name: $('[data-zname]', r).value, fee: $('[data-zfee]', r).value }));
      body.schedule = {
        enabled: $('#sched-on').checked,
        timezone: $('#sched-tz').value.trim(),
        days: $$('.sched-row').map((r) => ({ open: $('[data-open]', r).checked, from: $('[data-from]', r).value, to: $('[data-to]', r).value })),
      };
      try {
        const { settings, open } = await api('PUT', '/api/admin/settings', body);
        state.data.settings = settings;
        state.data.open = open;
        toast(T('saved'));
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });

    $('#pwform').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/password', { current: e.target.current.value, next: e.target.next.value });
        e.target.reset();
        toast(T('passwordChanged'));
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'weak_password' ? T('weakPassword') : T('wrongPassword'), true);
      }
    });

    $('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f || !confirm(T('importConfirm'))) return;
      try {
        await api('POST', '/api/admin/import', JSON.parse(await f.text()));
        await loadData();
        toast(T('imported'));
        renderShell();
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : T('invalidBackup'), true);
      }
    });
  };

  VIEWS.share = async (view) => {
    const s = state.data.settings;
    const coupons = state.data.coupons || [];
    const link = state.data.baseUrl;
    const qr = `/api/admin/qr.svg?text=${encodeURIComponent(link)}`;
    const text = `${T('shareText').replace('{name}', s.name)}\n${link}`;
    view.innerHTML = `
      <h2 class="title">${esc(T('shareTitle'))}</h2>
      <div class="card">
        <div class="qr-box">
          <img src="${qr}" alt="QR">
          <div>
            <p class="muted">${esc(T('shareSub'))}</p>
            <div class="share-row" style="margin-bottom:10px"><input class="input" readonly value="${esc(link)}"><button class="btn sm" data-act="copy" data-text="${esc(link)}" type="button">${esc(T('copy'))}</button></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <a class="btn line sm" href="${qr}" download="qr-${esc(s.name)}.svg">${esc(T('downloadQr'))}</a>
              <a class="btn wa sm" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 ${esc(T('shareWhatsApp'))}</a>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>🏷️ ${esc(T('coupons'))}</h3>
        <p class="muted small">${esc(T('couponsHint'))}</p>
        ${coupons.length ? coupons.map((c) => `<div class="cat-row">
          <span class="name"><code class="code">${esc(c.code)}</code> <span class="muted small">${c.type === 'percent' ? `${c.value}%` : esc(money(c.value))}${c.minOrder ? ` · ${esc(T('couponMin'))} ${esc(money(c.minOrder))}` : ''} · ${c.uses || 0}${c.maxUses ? `/${c.maxUses}` : ''} ${esc(T('used'))}</span></span>
          <label class="switch" title="${esc(T('active'))}"><input type="checkbox" data-coupon-active="${c.id}" ${c.active ? 'checked' : ''}><i></i></label>
          <button class="icon-btn" data-act="del-coupon" data-id="${c.id}" title="${esc(T('del'))}">🗑</button>
        </div>`).join('') : `<p class="muted">${esc(T('noCoupons'))}</p>`}
        <form id="cform" class="coupon-form">
          <label class="field"><span>${esc(T('code'))}</span><input name="code" required maxlength="30" placeholder="WELCOME10" style="text-transform:uppercase"></label>
          <label class="field"><span>${esc(T('couponType'))}</span><select name="type"><option value="percent">${esc(T('percent'))}</option><option value="fixed">${esc(T('fixed'))}</option></select></label>
          <label class="field"><span>${esc(T('value'))}</span><input name="value" type="number" min="0" step="any" required value="10"></label>
          <label class="field"><span>${esc(T('couponMin'))}</span><input name="minOrder" type="number" min="0" step="any" value="0"></label>
          <label class="field"><span>${esc(T('maxUses'))} <i class="muted" style="font-weight:600;font-style:normal">(${esc(T('maxUsesHint'))})</i></span><input name="maxUses" type="number" min="0" step="1" value="0"></label>
          <button class="btn" type="submit">${esc(T('addCoupon'))}</button>
        </form>
      </div>
      <div class="card">
        <h3>${esc(T('printPosters'))}</h3>
        <form id="qrform" class="share-row" target="_blank" action="/admin/print-qr">
          <label class="field" style="margin:0;flex:1"><span>${esc(T('tables'))}</span><input name="tables" type="number" min="0" max="100" value="${s.dineIn ? 10 : 0}"></label>
          <button class="btn" type="submit" style="align-self:flex-end">${esc(T('printPosters'))}</button>
        </form>
        <p class="muted small">${esc(T('tablesHint'))}</p>
      </div>
      <div class="card">
        <h3>💡 ${esc(T('tipsTitle'))}</h3>
        <ul class="checklist">${['tip1', 'tip2', 'tip3', 'tip4'].map((k) => `<li>✨ ${esc(T(k))}</li>`).join('')}</ul>
      </div>`;

    $('#cform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('POST', '/api/admin/coupons', { code: f.code.value, type: f.type.value, value: f.value.value, minOrder: f.minOrder.value, maxUses: f.maxUses.value });
        await loadData();
        toast(T('saved'));
        renderTab();
      } catch (err) {
        toast(err.code === 'coupon_exists' ? T('couponExists') : T('error'), true);
      }
    });
  };

  // ======================= modal =======================
  function openModal(html) {
    closeModal();
    const el = document.createElement('div');
    el.className = 'modal';
    el.id = 'modal';
    el.innerHTML = `<div class="back" data-close></div><div class="box" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal();
    });
    return $('.box', el);
  }
  function closeModal() {
    const m = $('#modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ======================= global actions =======================
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-tab],[data-act],[data-filter],[data-order],[data-move]');
    if (!el) return;
    try {
      if (el.dataset.tab) {
        e.preventDefault();
        state.tab = el.dataset.tab;
        history.replaceState(null, '', `#${state.tab}`);
        renderTab();
        window.scrollTo(0, 0);
        return;
      }
      if (el.dataset.filter !== undefined) {
        state.filter = el.dataset.filter;
        return renderTab();
      }
      if (el.dataset.order) {
        el.disabled = true;
        await api('PUT', `/api/admin/orders/${el.dataset.order}`, { status: el.dataset.status });
        return renderTab();
      }
      if (el.dataset.move) {
        const coll = el.dataset.move;
        const list = coll === 'categories' ? state.data.categories : siblingsOf(el.dataset.id);
        const ids = list.map((x) => x.id);
        const i = ids.indexOf(el.dataset.id);
        const j = i + Number(el.dataset.dir);
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        // Keep products in other categories in their relative place.
        const all = coll === 'categories' ? ids : mergeOrder(ids);
        await api('POST', '/api/admin/reorder', { collection: coll, ids: all });
        await loadData();
        return renderTab();
      }
      const act = el.dataset.act;
      if (act === 'logout') {
        await api('POST', '/api/logout');
        state.data = null;
        return boot();
      }
      if (act === 'copy') {
        await navigator.clipboard.writeText(el.dataset.text);
        return toast(T('copied'));
      }
      if (act === 'new-product') return productModal(null);
      if (act === 'edit-product') return productModal(state.data.products.find((p) => p.id === el.dataset.id));
      if (act === 'rename-cat') {
        const cat = state.data.categories.find((c) => c.id === el.dataset.id);
        const name = prompt(T('rename'), cat.name);
        if (!name || !name.trim()) return;
        await api('PUT', `/api/admin/categories/${cat.id}`, { name });
        await loadData();
        return renderTab();
      }
      if (act === 'del-coupon') {
        if (!confirm(T('confirmDelete'))) return;
        await api('DELETE', `/api/admin/coupons/${el.dataset.id}`);
        await loadData();
        return renderTab();
      }
      if (act === 'del-cat') {
        if (!confirm(T('confirmDelete'))) return;
        await api('DELETE', `/api/admin/categories/${el.dataset.id}`);
        await loadData();
        return renderTab();
      }
    } catch (err) {
      if (err.message !== 'unauthorized') toast(T('error'), true);
    }
  });

  function siblingsOf(productId) {
    const p = state.data.products.find((x) => x.id === productId);
    const known = state.data.categories.some((c) => c.id === p.categoryId);
    return state.data.products.filter((x) =>
      known ? x.categoryId === p.categoryId : !state.data.categories.some((c) => c.id === x.categoryId)
    );
  }

  function mergeOrder(reorderedSiblings) {
    const set = new Set(reorderedSiblings);
    const queue = [...reorderedSiblings];
    return state.data.products.map((p) => (set.has(p.id) ? queue.shift() : p.id));
  }

  document.addEventListener('change', async (e) => {
    if (e.target.dataset && e.target.dataset.actChange === 'lang') {
      await setLang(e.target.value);
      return state.data ? renderShell() : boot();
    }
    const couponId = e.target.dataset && e.target.dataset.couponActive;
    if (couponId) {
      try {
        await api('PUT', `/api/admin/coupons/${couponId}`, { active: e.target.checked });
        await loadData();
      } catch {
        toast(T('error'), true);
      }
      return;
    }
    const id = e.target.dataset && e.target.dataset.avail;
    if (!id) return;
    try {
      await api('PUT', `/api/admin/products/${id}`, { available: e.target.checked });
      await loadData();
      e.target.closest('.prod-row').classList.toggle('off', !e.target.checked);
    } catch {
      toast(T('error'), true);
    }
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (state.data && TABS.some(([k]) => k === h) && h !== state.tab) {
      state.tab = h;
      renderTab();
    }
  });

  // ======================= new-order polling =======================
  let pollTimer;
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((delay) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.2, ctx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + delay);
        o.stop(ctx.currentTime + delay + 0.16);
      });
    } catch { /* audio not allowed yet */ }
  }

  function startPolling() {
    clearInterval(pollTimer);
    const tick = async () => {
      if (!state.data) return;
      try {
        const { counts } = await api('GET', '/api/admin/orders?status=new');
        const prev = state.lastNew;
        state.counts = counts;
        state.lastNew = counts.new;
        updateNewDot();
        if (prev !== null && counts.new > prev) {
          beep();
          toast(T('newOrderAlert'));
          if (state.tab === 'orders' || state.tab === 'home') renderTab();
        }
      } catch { /* offline — try again next tick */ }
    };
    tick();
    pollTimer = setInterval(tick, 15000);
  }

  boot();
})();
