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

  const ICONS = '/img/icons.svg';
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;
  // Trend chip: ↑ 12% (green) / ↓ 5% (red); nothing when there's no previous data.
  const trend = (pct, hint) =>
    pct === null || pct === undefined
      ? ''
      : `<span class="trend ${pct >= 0 ? 'up' : 'down'}" title="${esc(hint || '')}">${ic(pct >= 0 ? 'trend-up' : 'trend-down')}${Math.abs(pct)}%</span>`;

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
  let agencyBrand = null; // white-label (agency mode)

  async function boot() {
    let s;
    try {
      s = await api('GET', '/api/state');
    } catch {
      app.innerHTML = `<div class="auth"><div class="auth-card"><p class="error">Error</p></div></div>`;
      return;
    }
    demo = s.demo;
    agencyBrand = s.brand && s.brand.name ? s.brand : null;
    await setLang(lang || s.lang);
    if (!s.setupDone) return renderSetup(s);
    if (!s.authed) return renderLogin();
    await loadData();
    renderShell();
    swRegistration().catch(() => {});
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

  // Login / setup screens: brand panel + form.
  const authShell = (form) => `
    <div class="auth">
      <aside class="auth-side">
        <div class="auth-brand">${agencyBrand ? `<b>${esc(agencyBrand.name)}</b>` : '<img src="/img/icon.svg" alt="" width="40" height="40"><b>Dukkan</b>'}</div>
        <h2>${esc(T('authTagline'))}</h2>
        <ul>${['authPoint1', 'authPoint2', 'authPoint3'].map((k) => `<li>${ic('check')}<span>${esc(T(k))}</span></li>`).join('')}</ul>
        <div class="auth-mock" aria-hidden="true">
          <div class="m-bubble">🛒 <b>#1024</b> · 2× Latte, 1× Croissant<br><small>Total $14.50 · 🚚 Delivery</small></div>
          <div class="m-bubble me">✅ ${esc(T('st_confirmed'))}</div>
        </div>
      </aside>
      <div class="auth-main">${form}</div>
    </div>`;

  function renderSetup(s) {
    app.innerHTML = authShell(`<form class="auth-card" id="setup" autocomplete="off">
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
      </form>`);
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
    app.innerHTML = authShell(`<form class="auth-card" id="login">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('loginTitle'))}</h1>
        <p class="sub">${esc(T('loginSub'))}</p>
        ${demo ? `<p class="demo-note">🧪 ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></p>` : ''}
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required autocomplete="current-password" value="${demo ? esc(demo.password) : ''}"></label>
        <button class="btn block" type="submit">${esc(T('login'))}</button>
        <p class="error" id="err"></p>
      </form>`);
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
    ['home', 'dashboard'], ['orders', 'receipt'], ['menu', 'menu-book'], ['appearance', 'palette'], ['share', 'megaphone'], ['connect', 'plug'], ['settings', 'settings'],
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
        <a class="btn sm" href="/" target="_blank" rel="noopener">${ic('external')}<span class="hide-sm">${esc(T('viewStore'))}</span></a>
        <button class="icon-btn" data-act="logout" title="${esc(T('logout'))}" aria-label="${esc(T('logout'))}" type="button">${ic('logout')}</button>
      </header>
      <div class="layout">
        <nav class="nav">${TABS.map(([k, ico]) => `<button type="button" data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${ic(ico, 'i ico')}<span>${esc(T(k))}</span>${k === 'orders' ? '<span class="dot" id="new-dot" hidden></span>' : ''}</button>`).join('')}</nav>
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
    const activeTab = document.querySelector('.nav button.active');
    if (activeTab && activeTab.scrollIntoView) activeTab.scrollIntoView({ inline: 'center', block: 'nearest' });
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
  const fmtDate = (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

  // Smooth area chart as an inline SVG (no chart library).
  function areaChart(values, labels, fmt) {
    const W = 640;
    const H = 200;
    const P = { t: 16, r: 12, b: 26, l: 12 };
    const max = Math.max(1, ...values);
    const n = values.length;
    const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, n - 1);
    const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max);
    const pts = values.map((v, i) => [x(i), y(v)]);
    // Catmull-Rom → cubic Bézier for a soft curve.
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${Math.min(H - P.b, c1[1]).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(H - P.b, c2[1]).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    const area = `${d} L${x(n - 1)},${H - P.b} L${x(0)},${H - P.b} Z`;
    const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="${P.l}" x2="${W - P.r}" y1="${P.t + (H - P.t - P.b) * f}" y2="${P.t + (H - P.t - P.b) * f}"/>`).join('');
    // Labels and the hover dot live in HTML so they don't stretch with the SVG.
    const ticks = labels.map((l, i) => ((i % 3 === 0 && n - 1 - i >= 2) || i === n - 1 ? `<span style="left:${(x(i) / W) * 100}%">${esc(l)}</span>` : '')).join('');
    const hits = values.map((v, i) => `<rect x="${x(i) - (W / n) / 2}" y="0" width="${W / n}" height="${H}" data-i="${i}"/>`).join('');
    return `<div class="chart" data-values='${esc(JSON.stringify(values.map(fmt)))}' data-labels='${esc(JSON.stringify(labels))}'>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
        <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".28"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
        <g class="grid">${grid}</g>
        <path d="${area}" fill="url(#cg)"/>
        <path d="${d}" class="line"/>
        <g class="hits">${hits}</g>
      </svg>
      <div class="ticks">${ticks}</div>
      <i class="hover-dot" hidden></i>
      <div class="chart-tip" hidden></div>
    </div>`;
  }

  function wireChart(root) {
    const chart = $('.chart', root);
    if (!chart) return;
    const values = JSON.parse(chart.dataset.values);
    const labels = JSON.parse(chart.dataset.labels);
    const svg = $('svg', chart);
    const dot = $('.hover-dot', chart);
    const tip = $('.chart-tip', chart);
    const path = $('.line', chart);
    chart.addEventListener('pointermove', (e) => {
      const r = e.target.closest('rect[data-i]');
      if (!r) return;
      const i = Number(r.dataset.i);
      const box = svg.getBoundingClientRect();
      const vbX = Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2;
      // Find the curve's y at this x.
      let lo = 0;
      let hi = path.getTotalLength();
      let pt = path.getPointAtLength(0);
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        pt = path.getPointAtLength(mid);
        if (pt.x < vbX) lo = mid;
        else hi = mid;
      }
      const left = `${(pt.x / 640) * box.width}px`;
      const top = `${(pt.y / 200) * box.height}px`;
      dot.hidden = false;
      dot.style.left = left;
      dot.style.top = top;
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(values[i])}</b><span>${esc(labels[i])}</span>`;
      tip.style.left = left;
      tip.style.top = top;
    });
    chart.addEventListener('pointerleave', () => {
      tip.hidden = true;
      dot.hidden = true;
    });
  }

  VIEWS.home = async (view) => {
    const st = (state.stats = await api('GET', '/api/admin/stats'));
    const s = state.data.settings;
    const link = state.data.baseUrl;
    const steps = [
      [!!s.whatsapp, T('stepWhatsapp'), 'settings'],
      [st.products > 0, T('stepProducts'), 'menu'],
      [!!s.logo, T('stepLogo'), 'appearance'],
      [st.month.orders > 0, T('stepShare'), 'share'],
    ];
    const allDone = demo || steps.every((x) => x[0]);
    const metric = state.chartMetric || 'orders';
    const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    const chartValues = st.days.map((d) => (metric === 'orders' ? d.orders : d.revenue));
    const fmt = (v) => (metric === 'orders' ? `${v} ${T('ordersWord')}` : money(v));
    const maxHour = Math.max(1, ...st.hours);
    const peak = st.hours.indexOf(Math.max(...st.hours));
    const hourLabel = (h) => new Date(2024, 0, 1, h).toLocaleTimeString(lang, { hour: 'numeric' });
    const mTotal = Math.max(1, st.methods.delivery + st.methods.pickup + st.methods.dineIn);
    const maxTop = Math.max(1, ...st.top.map((p) => p.qty));
    const status = !s.acceptingOrders ? T('acceptingOff') : state.data.open ? T('acceptingOn') : T('closedBySchedule');

    view.innerHTML = `
      <div class="page-head">
        <h2 class="title">${esc(T('home'))}</h2>
        <label class="pill-toggle ${s.acceptingOrders ? 'on' : ''}" title="${esc(status)}">
          <span class="dot"></span><span>${esc(s.acceptingOrders ? T('open') : T('closed'))}</span>
          <span class="switch"><input type="checkbox" id="accepting" ${s.acceptingOrders ? 'checked' : ''}><i></i></span>
        </label>
      </div>
      ${s.acceptingOrders && !state.data.open ? `<div class="banner warn">${ic('clock')}<span>${esc(T('closedBySchedule'))}</span></div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="kpi-ic c1">${ic('receipt')}</div><div class="kpi-body"><span class="label">${esc(T('today'))}</span><div class="value">${st.today.orders}${trend(st.today.change, T('vsYesterday'))}</div><span class="sub">${esc(money(st.today.revenue))}</span></div></div>
        <div class="kpi"><div class="kpi-ic c2">${ic('cash')}</div><div class="kpi-body"><span class="label">${esc(T('month'))}</span><div class="value">${esc(money(st.month.revenue))}${trend(st.month.change, T('vsPrevious'))}</div><span class="sub">${st.month.orders} ${esc(T('ordersWord'))}</span></div></div>
        <div class="kpi"><div class="kpi-ic c3">${ic('bag')}</div><div class="kpi-body"><span class="label">${esc(T('avgOrder'))}</span><div class="value">${esc(money(st.month.avg))}${trend(st.month.avgChange, T('vsPrevious'))}</div><span class="sub">${st.month.avgChange === null ? '&nbsp;' : esc(T('vsPrevious'))}</span></div></div>
        <div class="kpi"><div class="kpi-ic c4">${ic('users')}</div><div class="kpi-body"><span class="label">${esc(T('visitors'))}</span><div class="value">${st.visits.month}${trend(st.visits.change, T('vsPrevious'))}</div><span class="sub">${esc(T('conversion'))} <b>${st.visits.conversion}%</b> · ${st.visits.today} ${esc(T('visitorsToday'))}</span></div></div>
      </div>
      <div class="dash-cols">
        <div>
          <div class="card">
            <div class="card-head"><h3>${esc(T('last14'))}</h3>
              <div class="seg" role="tablist">
                <button type="button" data-metric="orders" class="${metric === 'orders' ? 'active' : ''}">${esc(T('orders'))}</button>
                <button type="button" data-metric="revenue" class="${metric === 'revenue' ? 'active' : ''}">${esc(T('revenue'))}</button>
              </div>
            </div>
            ${areaChart(chartValues, st.days.map((d) => dayLabel(d.date)), fmt)}
          </div>
          <div class="grid2 gap">
            <div class="card">
              <h3>${ic('clock')}${esc(T('peakHours'))}</h3>
              ${st.month.orders ? `<div class="hours">${st.hours.map((v, h) => `<div class="${h === peak ? 'peak' : ''}" style="height:${Math.max(4, (v / maxHour) * 100)}%" title="${esc(hourLabel(h))}: ${v}"></div>`).join('')}</div>
              <div class="hours-x"><span>${esc(hourLabel(0))}</span><span>${esc(hourLabel(12))}</span><span>${esc(hourLabel(23))}</span></div>
              <p class="muted small" style="margin:8px 0 0">${ic('sparkles')} <b>${esc(hourLabel(peak))}</b></p>` : `<p class="muted">${esc(T('noData'))}</p>`}
            </div>
            <div class="card">
              <h3>${ic('truck')}${esc(T('ordersByMethod'))}</h3>
              ${st.month.orders ? `<div class="stack">${['delivery', 'pickup', 'dineIn'].map((m) => `<div class="m-${m}" style="width:${(st.methods[m] / mTotal) * 100}%"></div>`).join('')}</div>
              <ul class="legend">${['delivery', 'pickup', 'dineIn'].map((m) => `<li><i class="m-${m}"></i><span>${esc(T(m))}</span><b>${Math.round((st.methods[m] / mTotal) * 100)}%</b></li>`).join('')}</ul>` : `<p class="muted">${esc(T('noData'))}</p>`}
            </div>
          </div>
          <div class="card">
            <h3>${ic('star')}${esc(T('topProducts'))}</h3>
            ${st.top.length ? `<ul class="top-list">${st.top.map((p, i) => `<li><span class="rank">${i + 1}</span><span class="nm">${esc(p.name)}<i style="width:${(p.qty / maxTop) * 100}%"></i></span><b>× ${p.qty}</b></li>`).join('')}</ul>` : `<p class="muted">${esc(T('noData'))}</p>`}
          </div>
        </div>
        <div>
          ${allDone ? '' : `<div class="card"><h3>${ic('rocket')}${esc(T('getStarted'))}</h3><div class="progress"><i style="width:${(steps.filter((x) => x[0]).length / steps.length) * 100}%"></i></div><ul class="checklist">${steps.map(([done, label, tab]) => `<li class="${done ? 'done' : ''}"><span class="tick">${done ? ic('check') : ''}</span>${done ? esc(label) : `<a href="#${tab}" data-tab="${tab}">${esc(label)}</a>`}</li>`).join('')}</ul></div>`}
          <div class="card">
            <h3>${ic('link')}${esc(T('yourLink'))}</h3>
            <div class="share-row"><input class="input" readonly value="${esc(link)}" id="link"><button class="btn sm" data-act="copy" data-text="${esc(link)}" type="button">${ic('copy')}</button></div>
            <div class="qr-mini"><img src="/api/admin/qr.svg?text=${encodeURIComponent(link)}" alt="QR" width="168" height="168"></div>
          </div>
        </div>
      </div>`;

    wireChart(view);
    $$('[data-metric]', view).forEach((b) =>
      b.addEventListener('click', () => {
        state.chartMetric = b.dataset.metric;
        renderTab();
      })
    );
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
        <span class="no">#${o.no}</span><span class="tag ${o.status}">${esc(T(`st_${o.status}`))}</span>${o.paid ? `<span class="tag paid">${ic('cash')}${esc(T('paidOnline'))}</span>` : ''}
        <span class="tag">${ic({ delivery: 'truck', pickup: 'store', dineIn: 'chair' }[o.method])}${esc(T(o.method))}${o.table ? ` · ${esc(T('table'))} ${esc(o.table)}` : ''}</span>
        <span class="muted small" style="margin-inline-start:auto">${esc(timeAgo(o.createdAt))}</span>
      </div>
      <div class="kv">
        <div>${ic('users')}<b>${esc(o.customer.name)}</b>${o.customer.phone ? ` · <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a>` : ''}</div>
        ${o.customer.address ? `<div>${ic('pin')}${o.zone ? `<b>${esc(o.zone)}</b> · ` : ''}${esc(o.customer.address)}</div>` : ''}
        ${o.customer.notes ? `<div>${ic('edit')}${esc(o.customer.notes)}</div>` : ''}
      </div>
      <ul class="order-items">${o.items.map((i) => `<li><span>${i.qty}× ${esc(i.name)}${i.variant ? ` <span class="muted">(${esc(i.variant)})</span>` : ''}</span><span>${esc(money(i.price * i.qty))}</span></li>`).join('')}
        ${o.discount ? `<li class="muted"><span>${esc(T('discount'))} (${esc(o.coupon)})</span><span>−${esc(money(o.discount))}</span></li>` : ''}
        ${o.deliveryFee ? `<li class="muted"><span>${esc(T('deliveryFee'))}${o.zone ? ` · ${esc(o.zone)}` : ''}</span><span>${esc(money(o.deliveryFee))}</span></li>` : ''}</ul>
      <div class="order-foot">
        <span class="total">${esc(T('total'))}: ${esc(money(o.total))}</span>
        <a class="icon-btn" href="/admin/receipt/${o.id}" target="_blank" rel="noopener" title="${esc(T('printReceipt'))}" aria-label="${esc(T('printReceipt'))}">${ic('print')}</a>
        ${phone ? `<a class="btn sm wa" href="https://wa.me/${phone}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('chatCustomer'))}</a>` : ''}
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
          <button class="icon-btn" data-move="categories" data-id="${c.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="${esc(T('up'))}">${ic('arrow-up')}</button>
          <button class="icon-btn" data-move="categories" data-id="${c.id}" data-dir="1" ${i === categories.length - 1 ? 'disabled' : ''} title="${esc(T('down'))}">${ic('arrow-down')}</button>
          <button class="icon-btn" data-act="rename-cat" data-id="${c.id}" title="${esc(T('edit'))}">${ic('edit')}</button>
          <button class="icon-btn danger" data-act="del-cat" data-id="${c.id}" title="${esc(T('del'))}">${ic('trash')}</button>
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
            <button class="icon-btn" data-move="products" data-id="${p.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="${esc(T('up'))}">${ic('arrow-up')}</button>
            <button class="icon-btn" data-act="edit-product" data-id="${p.id}" title="${esc(T('edit'))}">${ic('edit')}</button>
          </div>`).join('')}`).join('') : `<div class="empty-state"><div class="big">🍽️</div><p>${esc(T('noProductsYet'))}</p><button class="btn" data-act="new-product" type="button">+ ${esc(T('addProduct'))}</button></div>`}
      </div>
      <div class="card">
        <h3>${ic('file')}${esc(T('csvTitle'))}</h3>
        <p class="muted small">${esc(T('csvHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a class="btn line sm" href="/api/admin/products-template.csv" download>${ic('download')}${esc(T('csvTemplate'))}</a>
          <a class="btn line sm" href="/api/admin/products.csv" download>${ic('download')}${esc(T('csvExport'))}</a>
          <label class="btn sm" style="cursor:pointer">${ic('upload')}${esc(T('csvImport'))}<input type="file" accept=".csv,text/csv" id="csv-file" hidden></label>
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
    const variantRow = (v = { name: '', price: '' }) => `<div class="vrow"><input class="input" data-vname placeholder="${esc(T('variantName'))}" value="${esc(v.name)}" maxlength="60"><input class="input price" data-vprice type="number" min="0" step="any" placeholder="${esc(T('price'))}" value="${esc(v.price)}"><button type="button" class="icon-btn" data-vdel aria-label="${esc(T('del'))}">${ic('x')}</button></div>`;

    const box = openModal(`
      <h3>${esc(isNew ? T('addProduct') : T('editProduct'))}</h3>
      <form id="pform">
        <label class="field"><span>${esc(T('name'))} *</span><input name="name" required maxlength="100" value="${esc(p.name)}"></label>
        <div class="field"><span>${esc(T('image'))}</span>
          <div class="img-pick">
            <div class="preview" id="pimg"></div>
            <div style="display:grid;gap:6px;flex:1">
              <label class="btn sm line" style="cursor:pointer">${ic('image')}${esc(T('uploadImage'))}<input type="file" accept="image/*" id="pfile" hidden></label>
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
    `<div class="vrow" data-zid="${esc(z.id)}"><input class="input" data-zname placeholder="${esc(T('zoneName'))}" value="${esc(z.name)}" maxlength="60"><input class="input price" data-zfee type="number" min="0" step="any" placeholder="${esc(T('fee'))}" value="${esc(z.fee)}"><button type="button" class="icon-btn" data-zdel aria-label="${esc(T('del'))}">${ic('x')}</button></div>`;

  // 2024-01-07 was a Sunday, so day i = Sunday + i.
  const dayName = (i) => new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));

  const timezones = () => {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return []; }
  };

  // ---- Telegram notifications card (Settings) ----
  async function renderNotify(box) {
    const n = await api('GET', '/api/admin/notify');
    box.innerHTML = `
      <h3>${ic('bell')}${esc(T('notifications'))}${n.connected ? `<span class="ok-chip">${ic('check')}${esc(T('notifyConnected'))}</span>` : ''}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('notifyHint'))}</p>
      <ol class="steps-list"><li>${esc(T('notifyStep1'))}</li><li>${esc(T('notifyStep2'))}</li><li>${esc(T('notifyStep3'))}</li></ol>
      <form id="nf">
        <label class="field"><span>${esc(T('botToken'))}</span><input name="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA…" dir="ltr">${n.hasToken ? `<small>${esc(T('tokenSaved').replace('{hint}', n.tokenHint))}</small>` : ''}</label>
        <div class="share-row" style="align-items:flex-end">
          <label class="field" style="flex:1;margin:0"><span>${esc(T('chatId'))}</span><input name="chat" value="${esc(n.telegramChat)}" dir="ltr"></label>
          <button class="btn line" type="button" id="ndetect">${ic('search')}${esc(T('detectChat'))}</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          <button class="btn line" type="button" id="ntest" ${n.connected ? '' : 'disabled'}>${ic('bell')}${esc(T('sendTest'))}</button>
          ${n.hasToken ? `<button class="btn danger" type="button" id="nclear">${esc(T('disconnect'))}</button>` : ''}
        </div>
      </form>`;
    const f = $('#nf', box);
    const fail = (err, fallback) => toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'invalid_token' ? T('invalidToken') : T(fallback), true);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/notify', { telegramToken: f.token.value, telegramChat: f.chat.value });
        toast(T('saved'));
        renderNotify(box);
      } catch (err) { fail(err, 'error'); }
    });
    $('#ndetect', box).addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/admin/notify/detect', { telegramToken: f.token.value });
        if (!r.chats.length) return toast(T('chatNotFound'), true);
        f.chat.value = r.chats[0].id;
        toast(`${T('chatFound')} ${r.chats[0].name}`);
      } catch (err) { fail(err, 'chatNotFound'); }
    });
    $('#ntest', box).addEventListener('click', async () => {
      try {
        await api('POST', '/api/admin/notify/test', { text: T('testMessage') });
        toast(T('testSent'));
      } catch (err) { fail(err, 'testFailed'); }
    });
    const clear = $('#nclear', box);
    if (clear) clear.addEventListener('click', async () => {
      try { await api('PUT', '/api/admin/notify', { clear: true }); renderNotify(box); } catch (err) { fail(err, 'error'); }
    });
  }

  // ======================= CONNECTIONS =======================
  // Shared by every app: online payments, automatic WhatsApp, email,
  // Telegram, push notifications on this device, automatic backups.
  const copyRow = (value) => `<div class="share-row"><input class="input" readonly value="${esc(value)}" dir="ltr"><button class="btn sm" data-act="copy" data-text="${esc(value)}" type="button">${ic('copy')}</button></div>`;
  const failMsg = (err) => (err.code === 'demo' ? T('demoBlocked') : T({ invalid_key: 'cxInvalidKey', invalid_currency: 'cxInvalidCurrency', invalid_integration: 'cxInvalidIntegration', invalid_email: 'cxInvalidEmail', invalid_host: 'cxInvalidHost', invalid_port: 'cxInvalidPort', invalid_phone_id: 'cxInvalidPhoneId', invalid_template: 'cxInvalidTemplate', invalid_phone: 'cxInvalidPhone', not_ready: 'cxNotReady', payments_off: 'cxNotReady' }[err.code] || 'error'));
  const connChip = (on, label) => (on ? `<span class="ok-chip">${ic('check')}${esc(label || T('notifyConnected'))}</span>` : '');
  const fval = (f, name) => (f[name] ? (f[name].type === 'checkbox' ? f[name].checked : f[name].value) : undefined);

  async function renderPayments(box) {
    const p = await api('GET', '/api/admin/payments');
    const curGuess = /^[A-Z]{3}$/.test(state.data.settings.currency || '') ? state.data.settings.currency : 'EGP';
    box.innerHTML = `
      <h3>${ic('cash')}${esc(T('cxPayments'))}${connChip(p.ready, p.testMode ? T('cxTestMode') : T('cxLive'))}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxPaymentsHint'))}</p>
      <form id="payf">
        <div class="grid2">
          <label class="field"><span>${esc(T('cxProvider'))}</span><select name="provider"><option value="">${esc(T('cxNone'))}</option><option value="paymob" ${p.provider === 'paymob' ? 'selected' : ''}>Paymob (${esc(T('cxPaymobWhere'))})</option><option value="stripe" ${p.provider === 'stripe' ? 'selected' : ''}>Stripe (${esc(T('cxStripeWhere'))})</option></select></label>
          <label class="field"><span>${esc(T('cxCurrency'))}</span><input name="currency" maxlength="3" value="${esc(p.currency || curGuess)}" dir="ltr" style="text-transform:uppercase"><small>${esc(T('cxCurrencyHint'))}</small></label>
        </div>
        <div data-for="stripe" ${p.provider === 'stripe' ? '' : 'hidden'}>
          <ol class="steps-list"><li>${esc(T('cxStripeStep1'))}</li><li>${esc(T('cxStripeStep2'))}</li></ol>
          <label class="field"><span>${esc(T('cxSecretKey'))}</span><input name="stripeSecret" autocomplete="off" spellcheck="false" placeholder="sk_live_… / sk_test_…" dir="ltr">${p.stripeHasKey ? `<small>${esc(T('tokenSaved').replace('{hint}', p.stripeHint))}</small>` : ''}</label>
          <label class="field"><span>${esc(T('cxWebhookSecret'))} <small class="muted">(${esc(T('optional'))})</small></span><input name="stripeWebhookSecret" autocomplete="off" spellcheck="false" placeholder="whsec_…" dir="ltr"><small>${esc(T('cxStripeWebhookHint'))}</small></label>
          ${copyRow(p.stripeWebhookUrl)}
        </div>
        <div data-for="paymob" ${p.provider === 'paymob' ? '' : 'hidden'}>
          <ol class="steps-list"><li>${esc(T('cxPaymobStep1'))}</li><li>${esc(T('cxPaymobStep2'))}</li></ol>
          <div class="grid2">
            <label class="field"><span>${esc(T('cxRegion'))}</span><select name="paymobRegion">${[['eg', '🇪🇬 Egypt'], ['sa', '🇸🇦 Saudi Arabia'], ['ae', '🇦🇪 UAE'], ['om', '🇴🇲 Oman']].map(([k, l]) => `<option value="${k}" ${p.paymobRegion === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>${esc(T('cxIntegrationIds'))}</span><input name="paymobIntegrations" value="${esc(p.paymobIntegrations)}" placeholder="1234567, 7654321" dir="ltr"></label>
            <label class="field"><span>${esc(T('cxPublicKey'))}</span><input name="paymobPublic" value="${esc(p.paymobPublic)}" placeholder="egy_pk_…" dir="ltr" spellcheck="false"></label>
            <label class="field"><span>${esc(T('cxSecretKey'))}</span><input name="paymobSecret" autocomplete="off" placeholder="${p.paymobHasSecret ? '••••••••' : 'egy_sk_…'}" dir="ltr" spellcheck="false"></label>
            <label class="field"><span>HMAC</span><input name="paymobHmac" autocomplete="off" placeholder="${p.paymobHasHmac ? '••••••••' : ''}" dir="ltr" spellcheck="false"></label>
          </div>
          <small class="muted">${esc(T('cxPaymobCallbackHint'))}</small>${copyRow(p.paymobCallbackUrl)}
        </div>
        <div class="btn-row"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          <button class="btn line" type="button" data-pay-test ${p.ready ? '' : 'disabled'}>${ic('external')}${esc(T('cxTestPayment'))}</button>
          ${p.provider ? `<button class="btn danger" type="button" data-pay-clear>${esc(T('disconnect'))}</button>` : ''}</div>
      </form>`;
    const f = $('#payf', box);
    f.provider.addEventListener('change', () => $$('[data-for]', box).forEach((d) => (d.hidden = d.dataset.for !== f.provider.value)));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const k of ['provider', 'currency', 'stripeSecret', 'stripeWebhookSecret', 'paymobRegion', 'paymobIntegrations', 'paymobPublic', 'paymobSecret', 'paymobHmac']) body[k] = fval(f, k);
      try {
        await api('PUT', '/api/admin/payments', body);
        toast(T('saved'));
        renderPayments(box);
      } catch (err) { toast(failMsg(err), true); }
    });
    box.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('[data-pay-test]')) {
          const r = await api('POST', '/api/admin/payments/test', {});
          window.open(r.url, '_blank');
        } else if (e.target.closest('[data-pay-clear]')) {
          if (!confirm(T('cxDisconnectConfirm'))) return;
          await api('PUT', '/api/admin/payments', { clear: true });
          renderPayments(box);
        }
      } catch (err) { toast(err.message && err.code === 'provider_error' ? `${T('cxProviderError')}` : failMsg(err), true); }
    });
  }

  async function renderWhatsApp(box) {
    const w = await api('GET', '/api/admin/whatsapp');
    const sample = (k) => (k.sample[lang] || k.sample.en || '').replace(/\{\{(\d)\}\}/g, (m, n) => `{{${n}}}`);
    box.innerHTML = `
      <h3>${ic('whatsapp')}${esc(T('cxWhatsApp'))}${connChip(w.ready)}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxWhatsAppHint'))}</p>
      <details class="how"><summary>${esc(T('cxHowToConnect'))}</summary><ol class="steps-list"><li>${esc(T('cxWaStep1'))}</li><li>${esc(T('cxWaStep2'))}</li><li>${esc(T('cxWaStep3'))}</li><li>${esc(T('cxWaStep4'))}</li></ol></details>
      <form id="waf">
        <div class="grid2">
          <label class="field"><span>${esc(T('cxPhoneNumberId'))}</span><input name="phoneNumberId" value="${esc(w.phoneNumberId)}" inputmode="numeric" dir="ltr"></label>
          <label class="field"><span>${esc(T('cxTemplateLang'))}</span><input name="language" value="${esc(w.language || (lang === 'ar' ? 'ar' : 'en'))}" dir="ltr" maxlength="10"><small>ar · en · en_US · es · fr · tr · id · hi · pt_BR</small></label>
        </div>
        <label class="field"><span>${esc(T('cxAccessToken'))}</span><input name="token" autocomplete="off" spellcheck="false" placeholder="EAAG…" dir="ltr">${w.hasToken ? `<small>${esc(T('tokenSaved').replace('{hint}', w.tokenHint))}</small>` : ''}</label>
        <h4 class="sub-title">${ic('sparkles')}${esc(T('cxAutoMessages'))}</h4>
        <p class="muted small">${esc(T('cxTemplatesHint'))}</p>
        <div class="tpl-list">${w.kinds.map((k) => `<div class="tpl" data-kind="${esc(k.key)}">
          <label class="check"><span class="switch"><input type="checkbox" data-k="enabled" ${k.enabled ? 'checked' : ''}><i></i></span><span><b>${esc(T(`wa_${k.key}`))}</b></span></label>
          <div class="tpl-body"><code dir="auto">${esc(sample(k))}</code><button class="icon-btn" type="button" data-act="copy" data-text="${esc(sample(k))}" aria-label="${esc(T('copy'))}">${ic('copy')}</button></div>
          <label class="field tpl-name"><span>${esc(T('cxTemplateName'))}</span><input data-k="name" value="${esc(k.name)}" dir="ltr" spellcheck="false"></label>
        </div>`).join('')}</div>
        <div class="btn-row"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>${w.hasToken ? `<button class="btn danger" type="button" data-wa-clear>${esc(T('disconnect'))}</button>` : ''}</div>
      </form>
      ${w.ready ? `<div class="share-row" style="margin-top:14px"><input class="input" id="wa-to" placeholder="${esc(T('cxTestNumber'))}" dir="ltr" inputmode="tel"><button class="btn line" type="button" data-wa-test>${ic('whatsapp')}${esc(T('sendTest'))}</button></div>` : ''}
      ${w.log.length ? `<details class="how"><summary>${esc(T('cxRecentMessages'))}</summary><ul class="wa-log">${w.log.map((l) => `<li class="${l.ok ? 'ok' : 'bad'}">${ic(l.ok ? 'check' : 'x-circle', 'i xs')}<span>${esc(new Date(l.at).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(l.kind)} · ${esc(l.to)}</span>${l.error ? `<small>${esc(l.error)}</small>` : ''}</li>`).join('')}</ul></details>` : ''}`;
    const f = $('#waf', box);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const templates = {};
      for (const row of $$('.tpl', box)) templates[row.dataset.kind] = { enabled: $('[data-k=enabled]', row).checked, name: $('[data-k=name]', row).value };
      try {
        await api('PUT', '/api/admin/whatsapp', { token: f.token.value, phoneNumberId: f.phoneNumberId.value, language: f.language.value, templates });
        toast(T('saved'));
        renderWhatsApp(box);
      } catch (err) { toast(failMsg(err), true); }
    });
    box.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('[data-wa-test]')) {
          await api('POST', '/api/admin/whatsapp/test', { to: $('#wa-to', box).value });
          toast(T('testSent'));
          renderWhatsApp(box);
        } else if (e.target.closest('[data-wa-clear]')) {
          if (!confirm(T('cxDisconnectConfirm'))) return;
          await api('PUT', '/api/admin/whatsapp', { clear: true });
          renderWhatsApp(box);
        }
      } catch (err) { toast(err.code ? failMsg(err) : T('testFailed'), true); renderWhatsApp(box); }
    });
  }

  async function renderEmail(box) {
    const m = await api('GET', '/api/admin/email');
    box.innerHTML = `
      <h3>${ic('mail')}${esc(T('cxEmail'))}${connChip(m.ready)}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxEmailHint'))}</p>
      <form id="emf">
        <div class="grid3">
          <label class="field"><span>${esc(T('cxSmtpHost'))}</span><input name="host" value="${esc(m.host)}" placeholder="smtp.hostinger.com" dir="ltr" spellcheck="false"></label>
          <label class="field"><span>${esc(T('cxPort'))}</span><input name="port" type="number" value="${esc(m.port)}" dir="ltr"></label>
          <label class="field"><span>&nbsp;</span>${sw('secure', m.secure, 'SSL/TLS (465)')}</label>
          <label class="field"><span>${esc(T('cxUsername'))}</span><input name="user" value="${esc(m.user)}" autocomplete="off" dir="ltr" spellcheck="false"></label>
          <label class="field"><span>${esc(T('password'))}</span><input name="pass" type="password" autocomplete="new-password" placeholder="${m.hasPass ? '••••••••' : ''}"></label>
          <label class="field"><span>${esc(T('cxFrom'))}</span><input name="from" value="${esc(m.from)}" placeholder="${esc(state.data.settings.name)} &lt;hello@yourdomain.com&gt;" dir="ltr"></label>
        </div>
        <label class="field"><span>${esc(T('cxOwnerEmail'))}</span><input name="ownerEmail" type="email" value="${esc(m.ownerEmail)}" dir="ltr"></label>
        ${sw('alerts', m.alerts, esc(T('cxEmailAlerts')))}
        ${sw('backups', m.backups, esc(T('cxEmailBackups')))}
        <div class="btn-row"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button><button class="btn line" type="button" data-em-test ${m.ready ? '' : 'disabled'}>${ic('mail')}${esc(T('sendTest'))}</button>${m.host ? `<button class="btn danger" type="button" data-em-clear>${esc(T('disconnect'))}</button>` : ''}</div>
      </form>`;
    const f = $('#emf', box);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      for (const k of ['host', 'port', 'secure', 'user', 'pass', 'from', 'ownerEmail', 'alerts', 'backups']) body[k] = fval(f, k);
      try {
        await api('PUT', '/api/admin/email', body);
        toast(T('saved'));
        renderEmail(box);
      } catch (err) { toast(failMsg(err), true); }
    });
    box.addEventListener('click', async (e) => {
      try {
        if (e.target.closest('[data-em-test]')) {
          await api('POST', '/api/admin/email/test', { text: T('testMessage') });
          toast(T('testSent'));
        } else if (e.target.closest('[data-em-clear]')) {
          if (!confirm(T('cxDisconnectConfirm'))) return;
          await api('PUT', '/api/admin/email', { clear: true });
          renderEmail(box);
        }
      } catch (err) { toast(err.code === 'not_ready' ? T('cxNotReady') : `${T('testFailed')}`, true); }
    });
  }

  async function swRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' });
  }

  async function renderPush(box) {
    const p = await api('GET', '/api/admin/push');
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    let sub = null;
    if (supported) {
      try { const reg = await swRegistration(); sub = reg && (await reg.pushManager.getSubscription()); } catch { sub = null; }
    }
    const ios = /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;
    box.innerHTML = `
      <h3>${ic('bell')}${esc(T('cxPush'))}${connChip(!!sub, T('cxThisDeviceOn'))}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxPushHint'))}</p>
      ${ios ? `<p class="note-box">${ic('external', 'i xs')} ${esc(T('cxIosHint'))}</p>` : ''}
      <p class="muted small">${esc(T('cxDevices').replace('{n}', p.devices))}</p>
      <div class="btn-row">${!supported ? `<span class="muted">${esc(T('cxPushUnsupported'))}</span>` : sub ? `<button class="btn line" type="button" data-push-test>${ic('bell')}${esc(T('sendTest'))}</button><button class="btn danger" type="button" data-push-off>${esc(T('cxTurnOff'))}</button>` : `<button class="btn" type="button" data-push-on>${ic('bell')}${esc(T('cxTurnOn'))}</button>`}</div>`;
    box.onclick = async (e) => {
      try {
        if (e.target.closest('[data-push-on]')) {
          if ((await Notification.requestPermission()) !== 'granted') return toast(T('cxPushDenied'), true);
          const reg = await swRegistration();
          const key = Uint8Array.from(atob(p.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
          const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          await api('POST', '/api/admin/push/subscribe', { subscription: s.toJSON() });
          toast(T('saved'));
          renderPush(box);
        } else if (e.target.closest('[data-push-test]')) {
          const r = await api('POST', '/api/admin/push/test', { text: T('testMessage') });
          toast(r.sent ? T('testSent') : T('testFailed'), !r.sent);
        } else if (e.target.closest('[data-push-off]')) {
          const reg = await swRegistration();
          const s = await reg.pushManager.getSubscription();
          if (s) {
            await api('POST', '/api/admin/push/unsubscribe', { endpoint: s.endpoint });
            await s.unsubscribe();
          }
          renderPush(box);
        }
      } catch {
        toast(T('error'), true);
      }
    };
  }

  async function renderBackups(box) {
    const b = await api('GET', '/api/admin/backups');
    const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
    box.innerHTML = `
      <h3>${ic('download')}${esc(T('cxBackups'))}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('cxBackupsHint').replace('{n}', b.keep))}</p>
      ${b.backups.length ? `<ul class="backup-list">${b.backups.map((x) => `<li><span>${esc(fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span><small class="muted">${kb(x.size)}</small><a class="btn sm ghost" href="/api/admin/backups/${x.date}" download>${ic('download')}</a></li>`).join('')}</ul>` : `<p class="muted">${esc(T('cxNoBackups'))}</p>`}
      <button class="btn line sm" type="button" data-bk-now>${ic('download')}${esc(T('cxBackupNow'))}</button>`;
    box.onclick = async (e) => {
      if (!e.target.closest('[data-bk-now]')) return;
      try {
        await api('POST', '/api/admin/backups/now', {});
        toast(T('saved'));
        renderBackups(box);
      } catch (err) { toast(failMsg(err), true); }
    };
  }

  VIEWS.connect = async (view) => {
    view.innerHTML = `
      <h2 class="title">${esc(T('connect'))}</h2>
      <p class="muted" style="margin:-10px 0 16px">${esc(T('cxIntro'))}</p>
      <div class="card" id="cx-pay"></div>
      <div class="card" id="cx-wa"></div>
      <div class="grid2 gap cx-cols"><div class="card" id="cx-push"></div><div class="card" id="notify-card"></div></div>
      <div class="card" id="cx-email"></div>
      <div class="card" id="cx-backup"></div>`;
    await Promise.all([
      renderPayments($('#cx-pay', view)),
      renderWhatsApp($('#cx-wa', view)),
      renderPush($('#cx-push', view)),
      renderNotify($('#notify-card', view)),
      renderEmail($('#cx-email', view)),
      renderBackups($('#cx-backup', view)),
    ]);
  };

  // ======================= SETTINGS =======================
  VIEWS.settings = async (view) => {
    const s = state.data.settings;
    view.innerHTML = `
      <h2 class="title">${esc(T('settings'))}</h2>
      <form id="sform">
        <div class="card">
          <h3>${ic('store')}${esc(T('storeInfo'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('shopName'))}</span><input name="name" maxlength="80" value="${esc(s.name)}"></label>
            <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(s.lang)}</select></label>
          </div>
          <label class="field"><span>${esc(T('tagline'))}</span><input name="tagline" maxlength="140" value="${esc(s.tagline)}"></label>
          <label class="field"><span>${esc(T('about'))}</span><textarea name="about" rows="2" maxlength="1000">${esc(s.about)}</textarea></label>
        </div>

        <div class="card">
          <h3>${ic('truck')}${esc(T('ordering'))}</h3>
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
            <span>${ic('map')} ${esc(T('zones'))}</span>
            <small style="margin:0 0 8px">${esc(T('zonesHint'))}</small>
            <div id="zlist">${(s.zones || []).map(zoneRow).join('')}</div>
            <button type="button" class="btn sm ghost" id="zadd">${esc(T('addZone'))}</button>
          </div>
          ${sw('pickup', s.pickup, esc(T('pickupOn')))}
          ${sw('dineIn', s.dineIn, esc(T('dineInOn')))}
        </div>

        <div class="card">
          <h3>${ic('clock')}${esc(T('schedule'))}</h3>
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
          <h3>${ic('phone')}${esc(T('contact'))}</h3>
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
        <div style="position:sticky;bottom:80px;z-index:5;margin-bottom:16px"><button class="btn block" type="submit">${ic('check')}${esc(T('save'))}</button></div>
      </form>

      <div class="card">
        <h3>${ic('lock')}${esc(T('security'))}</h3>
        <form id="pwform" class="grid2">
          <label class="field"><span>${esc(T('currentPassword'))}</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>${esc(T('newPassword'))}</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
          <div><button class="btn line" type="submit">${esc(T('changePassword'))}</button></div>
        </form>
      </div>
      <div class="card">
        <h3>${ic('download')}${esc(T('backup'))}</h3>
        <p class="muted small">${esc(T('backupHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn line" href="/api/admin/export" download>${ic('download')}${esc(T('exportData'))}</a>
          <label class="btn line" style="cursor:pointer">${ic('upload')}${esc(T('importData'))}<input type="file" accept="application/json,.json" id="import-file" hidden></label>
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
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

  // ---- Design: theme, colour, font, logo & cover with a live phone preview ----
  const themeMini = (th) => `<div class="tp tp-${th}" aria-hidden="true"><i class="h"></i><div class="rows"><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i></div></div>`;

  function loadFontCss(fonts) {
    for (const f of fonts) {
      if ($(`link[data-font-css="${f.key}"]`)) continue;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = f.href;
      l.dataset.fontCss = f.key;
      document.head.appendChild(l);
    }
  }

  VIEWS.appearance = async (view) => {
    const s = state.data.settings;
    const opts = state.data.appearance;
    const draft = { theme: s.theme || 'fresh', color: s.color, font: s.font || 'cairo', logo: s.logo, cover: s.cover };
    const KEYS = Object.keys(draft);
    loadFontCss(opts.fonts);
    const imgPick = (key, wide) => `<div class="img-pick">
        <div class="preview${wide ? ' wide' : ''}" id="${key}-prev"></div>
        <div style="display:grid;gap:6px">
          <label class="btn sm line" style="cursor:pointer">${ic('upload')}${esc(T('uploadImage'))}<input type="file" accept="image/*" id="${key}-file" hidden></label>
          <button type="button" class="btn sm ghost" id="${key}-rm">${ic('trash')}${esc(T('removeImage'))}</button>
        </div>
      </div>`;

    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('appearance'))}</h2><span class="unsaved" id="unsaved" hidden><i></i>${esc(T('unsaved'))}</span></div>
      <div class="design">
        <div class="design-controls">
          <div class="card">
            <h3>${ic('sparkles')}${esc(T('themeLabel'))}</h3>
            <div class="themes">${opts.themes.map((th) => `<button type="button" class="theme-card" data-theme="${th}">${themeMini(th)}<b>${esc(T(`theme_${th}`))}</b><span>${esc(T(`themeDesc_${th}`))}</span></button>`).join('')}</div>
          </div>
          <div class="card">
            <h3>${ic('palette')}${esc(T('brandColor'))}</h3>
            <div class="swatches" id="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<label class="custom-color" title="${esc(T('brandColor'))}"><input type="color" id="color" value="${esc(draft.color)}"></label></div>
          </div>
          <div class="card">
            <h3><span class="aa">Aa</span>${esc(T('font'))}</h3>
            <div class="fonts">${opts.fonts.map((f) => `<button type="button" class="font-card" data-font="${f.key}" style="font-family:${esc(f.stack)}"><span class="sample">Aa أب</span><small>${esc(f.label)}</small></button>`).join('')}</div>
          </div>
          <div class="card">
            <h3>${ic('image')}${esc(T('logo'))} · ${esc(T('cover'))}</h3>
            <div class="grid2">
              <div class="field"><span>${esc(T('logo'))}</span>${imgPick('logo')}</div>
              <div class="field"><span>${esc(T('cover'))}</span>${imgPick('cover', true)}</div>
            </div>
          </div>
          <div class="save-bar"><button class="btn block" type="button" id="dsave">${ic('check')}${esc(T('save'))}</button></div>
        </div>
        <div class="design-preview">
          <div class="phone"><div class="notch"></div><iframe id="pv" src="/?preview=1&lang=${encodeURIComponent(s.lang)}" title="${esc(T('livePreview'))}"></iframe></div>
          <p class="muted small preview-hint">${ic('eye')}<span>${esc(T('previewHint'))}</span></p>
        </div>
      </div>`;

    const pv = $('#pv');
    const send = () => {
      const font = opts.fonts.find((f) => f.key === draft.font) || opts.fonts[0];
      if (pv.contentWindow) {
        pv.contentWindow.postMessage(
          { type: 'dukkan-preview', theme: draft.theme, color: draft.color, fontStack: font.stack, fontHref: font.href, logo: draft.logo, cover: draft.cover },
          location.origin
        );
      }
    };
    const sync = () => {
      $$('.theme-card', view).forEach((b) => b.classList.toggle('active', b.dataset.theme === draft.theme));
      $$('.font-card', view).forEach((b) => b.classList.toggle('active', b.dataset.font === draft.font));
      $$('#swatches [data-color]', view).forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === draft.color.toLowerCase()));
      $('#color').value = draft.color;
      view.style.setProperty('--c', draft.color);
      $('#logo-prev').innerHTML = draft.logo ? `<img src="${esc(draft.logo)}" alt="">` : ic('store');
      $('#cover-prev').innerHTML = draft.cover ? `<img src="${esc(draft.cover)}" alt="">` : ic('image');
      $('#logo-rm').hidden = !draft.logo;
      $('#cover-rm').hidden = !draft.cover;
      $('#unsaved').hidden = !KEYS.some((k) => (draft[k] || '') !== (s[k] || ''));
      send();
    };
    pv.addEventListener('load', send);

    view.addEventListener('click', (e) => {
      const th = e.target.closest('[data-theme]');
      const fo = e.target.closest('[data-font]');
      const co = e.target.closest('[data-color]');
      if (th) draft.theme = th.dataset.theme;
      else if (fo) draft.font = fo.dataset.font;
      else if (co) draft.color = co.dataset.color;
      else return;
      sync();
    });
    $('#color').addEventListener('input', (e) => {
      draft.color = e.target.value;
      sync();
    });
    for (const [key, max] of [['logo', 512], ['cover', 1600]]) {
      $(`#${key}-file`).addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          draft[key] = await uploadFile(f, max);
          sync();
        } catch (err) {
          toast(err.code === 'too_large' ? T('tooLarge') : T('error'), true);
        }
      });
      $(`#${key}-rm`).addEventListener('click', () => {
        draft[key] = '';
        sync();
      });
    }
    $('#dsave').addEventListener('click', async () => {
      try {
        const { settings, open } = await api('PUT', '/api/admin/settings', draft);
        state.data.settings = settings;
        state.data.open = open;
        document.documentElement.style.setProperty('--brand', settings.color);
        toast(T('saved'));
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });
    sync();
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
              <a class="btn line sm" href="${qr}" download="qr-${esc(s.name)}.svg">${ic('download')}${esc(T('downloadQr'))}</a>
              <a class="btn wa sm" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('shareWhatsApp'))}</a>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>${ic('tag')}${esc(T('coupons'))}</h3>
        <p class="muted small">${esc(T('couponsHint'))}</p>
        ${coupons.length ? coupons.map((c) => `<div class="cat-row">
          <span class="name"><code class="code">${esc(c.code)}</code> <span class="muted small">${c.type === 'percent' ? `${c.value}%` : esc(money(c.value))}${c.minOrder ? ` · ${esc(T('couponMin'))} ${esc(money(c.minOrder))}` : ''} · ${c.uses || 0}${c.maxUses ? `/${c.maxUses}` : ''} ${esc(T('used'))}</span></span>
          <label class="switch" title="${esc(T('active'))}"><input type="checkbox" data-coupon-active="${c.id}" ${c.active ? 'checked' : ''}><i></i></label>
          <button class="icon-btn danger" data-act="del-coupon" data-id="${c.id}" title="${esc(T('del'))}">${ic('trash')}</button>
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
        <h3>${ic('qr')}${esc(T('printPosters'))}</h3>
        <form id="qrform" class="share-row" target="_blank" action="/admin/print-qr">
          <label class="field" style="margin:0;flex:1"><span>${esc(T('tables'))}</span><input name="tables" type="number" min="0" max="100" value="${s.dineIn ? 10 : 0}"></label>
          <button class="btn" type="submit" style="align-self:flex-end">${ic('print')}${esc(T('printPosters'))}</button>
        </form>
        <p class="muted small">${esc(T('tablesHint'))}</p>
      </div>
      <div class="card">
        <h3>${ic('bulb')}${esc(T('tipsTitle'))}</h3>
        <ul class="checklist">${['tip1', 'tip2', 'tip3', 'tip4'].map((k) => `<li><span class="tick">${ic('sparkles')}</span>${esc(T(k))}</li>`).join('')}</ul>
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
        const r = await api('PUT', `/api/admin/orders/${el.dataset.order}`, { status: el.dataset.status });
        if (r && r.autoSent) toast(T('cxAutoSent'));
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
