(() => {
  'use strict';

  const D = window.DUKKAN;
  const t = D.t;
  const shop = D.shop;
  const products = new Map(D.products.map((p) => [p.id, p]));
  const CART_KEY = 'dukkan-cart';
  const CUSTOMER_KEY = 'dukkan-customer';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const ic = (name) => `<svg class="i" aria-hidden="true"><use href="${D.icons}#i-${name}"/></svg>`;
  const METHOD_ICON = { delivery: 'truck', pickup: 'store', dineIn: 'chair' };

  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
  const money = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const str = Number.isInteger(v) ? String(v) : v.toFixed(2);
    const cur = shop.currency || '';
    return PREFIX.includes(cur) ? `${cur}${str}` : `${str} ${cur}`.trim();
  };

  const storage = {
    get(key, fallback) {
      try {
        const v = JSON.parse(localStorage.getItem(key));
        return v == null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* private mode — cart just won't persist */
      }
    },
  };

  // ---------- cart state ----------
  let cart = storage.get(CART_KEY, []).filter((l) => {
    const p = products.get(l.id);
    if (!p || !p.available) return false;
    if (p.variants.length) return p.variants.some((v) => v.name === l.variant);
    return true;
  });

  const unitPrice = (line) => {
    const p = products.get(line.id);
    if (!p) return 0;
    if (p.variants.length) {
      const v = p.variants.find((x) => x.name === line.variant);
      return v ? v.price : 0;
    }
    return p.price;
  };
  const subtotal = () => cart.reduce((s, l) => s + unitPrice(l) * l.qty, 0);
  const count = () => cart.reduce((s, l) => s + l.qty, 0);
  const findZone = (id) => shop.zones.find((z) => z.id === id) || null;
  const deliveryFee = (method, sub, zoneId) => {
    if (method !== 'delivery') return 0;
    if (shop.freeDeliveryOver > 0 && sub >= shop.freeDeliveryOver) return 0;
    if (shop.zones.length) {
      const z = findZone(zoneId);
      return z ? z.fee : 0;
    }
    return shop.deliveryFee;
  };

  function saveCart() {
    storage.set(CART_KEY, cart);
    renderCartBar();
  }

  function addToCart(id, variant, qty, fromEl) {
    const key = `${id}|${variant || ''}`;
    const line = cart.find((l) => `${l.id}|${l.variant || ''}` === key);
    if (line) line.qty += qty;
    else cart.push({ id, variant: variant || '', qty });
    saveCart();
    const bar = $('#cartbar button');
    flyToCart(fromEl, products.get(id)).then(() => {
      bar.classList.remove('bump');
      void bar.offsetWidth;
      bar.classList.add('bump');
    });
    if (navigator.vibrate) navigator.vibrate(12);
    toast(products.get(id).name);
  }

  // A copy of the product picture flies from the card into the cart bar.
  function flyToCart(fromEl, p) {
    const target = $('#cartbar .bag');
    if (!fromEl || !target || !fromEl.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    const a = fromEl.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    if (!a.width || !b.width) return Promise.resolve();
    const size = Math.min(a.width, a.height, 90);
    const ghost = document.createElement('div');
    ghost.className = 'fly';
    ghost.style.cssText = `width:${size}px;height:${size}px;left:${a.left + a.width / 2 - size / 2}px;top:${a.top + a.height / 2 - size / 2}px;--h:${p.hue}`;
    ghost.style.background = getComputedStyle(fromEl).background;
    ghost.innerHTML = thumbHtml(p);
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = ghost.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 80}px) scale(.7)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0.4 },
      ],
      { duration: 650, easing: 'cubic-bezier(.5,0,.3,1)' }
    );
    return anim.finished.then(() => ghost.remove(), () => ghost.remove());
  }

  function renderCartBar() {
    const n = count();
    $('#cartbar').hidden = n === 0;
    $('#cart-count').textContent = n;
    $('#cart-sum').textContent = money(subtotal());
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.innerHTML = `${ic('check')}<span>${esc(msg)}</span>`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // ---------- sheet ----------
  const sheet = $('#sheet');
  let sheetBody = $('#sheet-body');
  let lastFocus = null;

  function openSheet(html, onMount) {
    if (sheet.hidden) lastFocus = document.activeElement;
    $('#toast').classList.remove('show');
    // Fresh container each time so listeners from a previous view don't linger.
    const fresh = sheetBody.cloneNode(false);
    sheetBody.replaceWith(fresh);
    sheetBody = fresh;
    sheetBody.innerHTML = html;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(sheetBody);
    $('.close', sheet).focus({ preventScroll: true });
  }

  function closeSheet() {
    sheet.hidden = true;
    $('.panel', sheet).style.transform = '';
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  // Swipe the sheet down to close it (phones).
  (() => {
    const panel = $('.panel', sheet);
    let startY = null;
    let dy = 0;
    panel.addEventListener('touchstart', (e) => {
      if (panel.scrollTop > 0 || e.touches.length !== 1 || e.target.closest('input,textarea,select,.options,.methods')) return;
      startY = e.touches[0].clientY;
      dy = 0;
    }, { passive: true });
    panel.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      if (dy > 0) {
        panel.classList.add('dragging');
        panel.style.transform = `translateY(${dy}px)`;
      }
    }, { passive: true });
    panel.addEventListener('touchend', () => {
      if (startY === null) return;
      panel.classList.remove('dragging');
      if (dy > 110) {
        panel.classList.add('closing');
        panel.style.transform = 'translateY(100%)';
        setTimeout(() => { panel.classList.remove('closing'); closeSheet(); }, 200);
      } else {
        panel.classList.add('closing');
        panel.style.transform = '';
        setTimeout(() => panel.classList.remove('closing'), 220);
      }
      startY = null;
    });
  })();

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeSheet();
  });

  const thumbHtml = (p) =>
    p.image ? `<img src="${esc(p.image)}" alt="">` : `<span class="emoji">${esc(p.emoji || p.name.charAt(0))}</span>`;
  let lastAddSource = null;

  // ---------- product sheet ----------
  function openProduct(id) {
    const p = products.get(id);
    if (!p) return;
    let qty = 1;
    const hasVariants = p.variants.length > 0;
    const html = `
      <div class="p-hero" style="--h:${p.hue}">${thumbHtml(p)}</div>
      <h2 id="sheet-title">${esc(p.name)}</h2>
      ${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
      ${hasVariants
        ? `<div class="options" role="radiogroup">${p.variants
            .map(
              (v, i) => `<label class="opt"><input type="radio" name="variant" value="${esc(v.name)}" ${i === 0 ? 'checked' : ''}>
                <span>${esc(v.name)}</span><span class="op-price">${esc(money(v.price))}</span></label>`
            )
            .join('')}</div>`
        : `<p class="price" style="font-size:20px;margin:12px 0">${esc(money(p.price))}${p.comparePrice ? ` <s class="compare">${esc(money(p.comparePrice))}</s>` : ''}</p>`}
      ${p.available
        ? `<div class="row end">
            <div class="stepper"><button type="button" data-q="-1" aria-label="-">${ic('minus')}</button><span id="pq">1</span><button type="button" data-q="1" aria-label="+">${ic('plus')}</button></div>
            <button class="btn" type="button" id="padd" style="flex:1"></button>
          </div>`
        : `<p class="warn">${esc(t.soldOut)}</p>`}`;

    openSheet(html, (root) => {
      if (!p.available) return;
      const btn = $('#padd', root);
      const selected = () => (hasVariants ? $('input[name=variant]:checked', root).value : '');
      const price = () => (hasVariants ? p.variants.find((v) => v.name === selected()).price : p.price);
      const update = () => {
        $('#pq', root).textContent = qty;
        btn.textContent = `${t.addToCart} · ${money(price() * qty)}`;
      };
      root.addEventListener('change', update);
      $$('[data-q]', root).forEach((b) =>
        b.addEventListener('click', () => {
          qty = Math.max(1, Math.min(99, qty + Number(b.dataset.q)));
          update();
        })
      );
      btn.addEventListener('click', () => {
        const from = lastAddSource;
        closeSheet();
        addToCart(p.id, selected(), qty, from);
      });
      update();
    });
  }

  // ---------- cart / checkout sheet ----------
  function openCart() {
    const saved = storage.get(CUSTOMER_KEY, {});
    let method = shop.methods.includes(saved.method) ? saved.method : shop.methods[0];
    if (D.table && shop.methods.includes('dineIn')) method = 'dineIn';
    let zoneId = findZone(saved.zone) ? saved.zone : '';
    let coupon = null; // { code, discount }

    const html = `
      <h2 id="sheet-title">${esc(t.cart)}</h2>
      <ul class="lines" id="lines"></ul>
      <div id="checkout">
        ${shop.methods.length > 1
          ? `<div class="field"><span>${esc(t.orderMethod)}</span><div class="methods">${shop.methods
              .map((m) => `<label><input type="radio" name="method" value="${m}" ${m === method ? 'checked' : ''}>${ic(METHOD_ICON[m])}${esc(t[m])}</label>`)
              .join('')}</div></div>`
          : ''}
        <form id="form" novalidate>
          <label class="field"><span>${esc(t.yourName)} *</span><input name="name" autocomplete="name" required maxlength="80" value="${esc(saved.name || '')}"></label>
          <label class="field" data-for="delivery pickup"><span>${esc(t.yourPhone)} *</span><input name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(saved.phone || '')}"></label>
          ${shop.zones.length
            ? `<label class="field" data-for="delivery"><span>${esc(t.zone)} *</span><select name="zone"><option value="">${esc(t.chooseZone)}</option>${shop.zones
                .map((z) => `<option value="${esc(z.id)}" ${z.id === zoneId ? 'selected' : ''}>${esc(z.name)}${z.fee ? ` (+${esc(money(z.fee))})` : ''}</option>`)
                .join('')}</select></label>`
            : ''}
          <label class="field" data-for="delivery"><span>${esc(t.address)} *</span><textarea name="address" rows="2" autocomplete="street-address" maxlength="300">${esc(saved.address || '')}</textarea></label>
          <label class="field" data-for="dineIn"><span>${esc(t.table)} *</span><input name="table" inputmode="numeric" maxlength="20" value="${esc(D.table || '')}"></label>
          <label class="field"><span>${esc(t.notes)}</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>
          ${shop.hasCoupons
            ? `<div class="field"><span>${esc(t.coupon)}</span><div class="coupon-row"><input id="coupon" maxlength="30" autocomplete="off" autocapitalize="characters"><button type="button" id="apply-coupon">${esc(t.apply)}</button></div><div class="coupon-msg" id="coupon-msg"></div></div>`
            : ''}
          <div class="summary" id="summary"></div>
          <div id="minwarn"></div>
          <button class="btn wa" type="submit" id="send">
            ${ic('whatsapp')}
            <span>${esc(t.sendOrder)}</span>
          </button>
          <p class="err" id="err" role="alert"></p>
          <p class="note">🔒 ${esc(t.rememberMe)}</p>
        </form>
      </div>`;

    openSheet(html, (root) => {
      const form = $('#form', root);

      const applyMethod = () => {
        $$('[data-for]', root).forEach((el) => {
          el.hidden = !el.dataset.for.split(' ').includes(method);
        });
      };

      const renderLines = () => {
        if (!cart.length) {
          $('#lines', root).innerHTML = `<p class="empty">${esc(t.emptyCart)}</p>`;
          $('#checkout', root).hidden = true;
          return;
        }
        $('#lines', root).innerHTML = cart
          .map((l, i) => {
            const p = products.get(l.id);
            return `<li>
              <div class="l-thumb" style="--h:${p.hue}">${thumbHtml(p)}</div>
              <div class="l-name"><b>${esc(p.name)}</b>${l.variant ? `<small>${esc(l.variant)}</small>` : ''}<small>${esc(money(unitPrice(l) * l.qty))}</small></div>
              <div class="stepper"><button type="button" data-line="${i}" data-d="-1" aria-label="-">${ic(l.qty === 1 ? 'trash' : 'minus')}</button><span>${l.qty}</span><button type="button" data-line="${i}" data-d="1" aria-label="+">${ic('plus')}</button></div>
            </li>`;
          })
          .join('');
        const sub = subtotal();
        const fee = deliveryFee(method, sub, zoneId);
        const disc = coupon ? coupon.discount : 0;
        const pendingZone = method === 'delivery' && shop.zones.length && !zoneId;
        $('#summary', root).innerHTML = `
          <div><span>${esc(t.subtotal)}</span><span>${esc(money(sub))}</span></div>
          ${disc ? `<div class="disc"><span>${esc(t.discount)} (${esc(coupon.code)})</span><span>−${esc(money(disc))}</span></div>` : ''}
          ${method === 'delivery' ? `<div><span>${esc(t.deliveryFee)}</span><span>${pendingZone ? '—' : fee ? esc(money(fee)) : esc(t.free)}</span></div>` : ''}
          <div class="total"><span>${esc(t.total)}</span><span>${esc(money(sub - disc + fee))}</span></div>`;
        const below = shop.minOrder > 0 && sub < shop.minOrder;
        $('#minwarn', root).innerHTML = below ? `<p class="warn">${esc(t.minOrder)}: ${esc(money(shop.minOrder))}</p>` : '';
        $('#send', root).disabled = below || !shop.acceptingOrders;
        if (!shop.acceptingOrders) $('#err', root).textContent = shop.closedText || t.closed;
      };

      // Discount codes are checked (and priced) by the server.
      const checkCoupon = async (code, quiet) => {
        const msg = $('#coupon-msg', root);
        if (!code) {
          coupon = null;
          msg.textContent = '';
          return renderLines();
        }
        try {
          const res = await fetch('/api/coupon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dukkan': '1' },
            body: JSON.stringify({ code, items: cart.map((l) => ({ id: l.id, variant: l.variant, qty: l.qty })) }),
          });
          const data = await res.json();
          if (!res.ok) throw Object.assign(new Error(data.error), { data });
          coupon = { code: data.code, discount: data.discount };
          msg.className = 'coupon-msg ok';
          msg.textContent = `✓ ${t.couponApplied}: −${money(data.discount)}`;
        } catch (ex) {
          coupon = null;
          msg.className = 'coupon-msg bad';
          const d = ex.data || {};
          msg.textContent = d.error === 'coupon_min_order' ? `${t.minOrder}: ${money(d.minOrder)}` : quiet ? '' : t.couponInvalid;
        }
        renderLines();
      };
      const couponBtn = $('#apply-coupon', root);
      if (couponBtn) {
        couponBtn.addEventListener('click', () => checkCoupon($('#coupon', root).value.trim()));
        $('#coupon', root).addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            checkCoupon(e.target.value.trim());
          }
        });
      }

      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-line]');
        if (!b) return;
        const line = cart[Number(b.dataset.line)];
        line.qty += Number(b.dataset.d);
        if (line.qty <= 0) cart.splice(Number(b.dataset.line), 1);
        saveCart();
        renderLines();
        if (coupon && cart.length) checkCoupon(coupon.code, true);
      });

      root.addEventListener('change', (e) => {
        if (['method', 'zone'].includes(e.target.name)) $('#err', root).textContent = '';
        if (e.target.name === 'method') {
          method = e.target.value;
          applyMethod();
          renderLines();
        }
        if (e.target.name === 'zone') {
          zoneId = e.target.value;
          renderLines();
        }
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#err', root);
        err.textContent = '';
        const f = Object.fromEntries(new FormData(form));
        const need = ['name'];
        if (method !== 'dineIn') need.push('phone');
        if (method === 'delivery') need.push('address');
        if (method === 'dineIn') need.push('table');
        if (method === 'delivery' && shop.zones.length) need.push('zone');
        const missing = need.find((k) => !String(f[k] || '').trim());
        if (missing) {
          err.textContent = `${t.required}: ${t[{ name: 'yourName', phone: 'yourPhone', address: 'address', table: 'table', zone: 'zone' }[missing]]}`;
          form.elements[missing].focus();
          return;
        }

        const btn = $('#send', root);
        btn.disabled = true;
        $('span', btn).textContent = t.sending;
        try {
          const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Dukkan': '1' },
            body: JSON.stringify({
              items: cart.map((l) => ({ id: l.id, variant: l.variant, qty: l.qty })),
              method,
              table: f.table,
              zone: method === 'delivery' ? zoneId : '',
              coupon: coupon ? coupon.code : '',
              customer: { name: f.name, phone: f.phone, address: f.address, notes: f.notes },
            }),
          });
          const data = await res.json();
          if (!res.ok) throw Object.assign(new Error(data.error), { code: data.error });
          storage.set(CUSTOMER_KEY, { name: f.name, phone: f.phone, address: f.address, method, zone: zoneId });
          cart = [];
          saveCart();
          showDone(data);
          // Paying online: the customer stays here to pay; WhatsApp stays one tap away.
          if (!data.payOnline) {
            // New tab keeps the confirmation visible; fall back if popups are blocked.
            // ('noopener' would make window.open return null, so detach manually.)
            const win = window.open(data.whatsappUrl, '_blank');
            if (win) win.opener = null;
            else window.location.href = data.whatsappUrl;
          }
        } catch (ex) {
          const messages = {
            closed: shop.closedText || t.closed,
            below_minimum: `${t.minOrder}: ${money(shop.minOrder)}`,
            zone_required: `${t.required}: ${t.zone}`,
            invalid_coupon: t.couponInvalid,
            coupon_min_order: t.couponInvalid,
          };
          err.textContent = messages[ex.code] || t.errorGeneric;
          if (ex.code === 'unavailable' || ex.code === 'invalid_variant') setTimeout(() => location.reload(), 1500);
          btn.disabled = false;
          $('span', btn).textContent = t.sendOrder;
        }
      });

      applyMethod();
      renderLines();
    });
  }

  function showDone(data) {
    openSheet(`
      <div class="done">
        <div class="confetti">${confetti()}</div>
        <svg class="check-anim" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/><path d="M30 52 l14 14 l27 -30"/></svg>
        <h2 id="sheet-title">${esc(t.orderSent)}</h2>
        <div class="no">${esc(t.orderNo)} #${esc(data.no)} · ${esc(money(data.total))}</div>
        <p class="muted">${esc(data.payOnline ? t.payOnlineHint : t.orderSentHint)}</p>
        ${data.payOnline ? `<button class="btn" type="button" id="pay-online">${ic('cash')}${esc(t.payOnline)}</button>` : ''}
        <a class="btn wa${data.payOnline ? ' ghost-wa' : ''}" href="${esc(data.whatsappUrl)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(t.openWhatsApp)}</a>
        <button class="btn ghost" type="button" data-close>${esc(t.backToMenu)}</button>
      </div>`, (el) => {
      const pay = $('#pay-online', el);
      if (pay) pay.addEventListener('click', () => payOrder(data.token, pay));
    });
  }

  async function payOrder(token, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(token)}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dukkan': '1' }, body: '{}' });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error);
      location.href = r.url;
    } catch {
      toast(t.payFailed);
      btn.disabled = false;
    }
  }

  // Back from the payment page: show the order's payment status.
  async function showPaymentResult() {
    const q = new URLSearchParams(location.search);
    const token = q.get('order');
    if (!token) return;
    history.replaceState(null, '', location.pathname + (q.get('table') ? `?table=${encodeURIComponent(q.get('table'))}` : ''));
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(token)}`);
      if (!res.ok) return;
      const o = await res.json();
      openSheet(`<div class="done">
        ${o.paid ? `<div class="confetti">${confetti()}</div><svg class="check-anim" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/><path d="M30 52 l14 14 l27 -30"/></svg>` : ''}
        <h2 id="sheet-title">${esc(o.paid ? t.paidTitle : t.payConfirming)}</h2>
        <div class="no">${esc(t.orderNo)} #${esc(o.no)} · ${esc(money(o.total))}</div>
        ${!o.paid && o.status !== 'cancelled' ? `<button class="btn" type="button" id="pay-online">${ic('cash')}${esc(t.payOnline)}</button>` : ''}
        <button class="btn ghost" type="button" data-close>${esc(t.backToMenu)}</button>
      </div>`, (el) => {
        const pay = $('#pay-online', el);
        if (pay) pay.addEventListener('click', () => payOrder(token, pay));
      });
    } catch { /* offline */ }
  }

  function confetti() {
    const colors = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', getComputedStyle(document.documentElement).getPropertyValue('--brand')];
    let out = '';
    for (let i = 0; i < 28; i++) {
      const left = 10 + Math.random() * 80;
      const dx = Math.round((Math.random() - 0.5) * 160);
      const rot = Math.round(Math.random() * 720 - 360);
      const delay = (Math.random() * 0.25).toFixed(2);
      out += `<i style="left:${left}%;background:${colors[i % colors.length]};--dx:${dx}px;--rot:${rot}deg;animation-delay:${delay}s"></i>`;
    }
    return out;
  }

  // ---------- menu interactions ----------
  $('#menu').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    const card = e.target.closest('.card');
    if (card) lastAddSource = $('.thumb', card);
    if (add) {
      e.stopPropagation();
      const p = products.get(add.dataset.add);
      if (p.variants.length) openProduct(p.id);
      else addToCart(p.id, '', 1, lastAddSource);
      return;
    }
    if (card) openProduct(card.dataset.id);
  });
  $('#menu').addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openProduct(card.dataset.id);
    }
  });
  $('#open-cart').addEventListener('click', openCart);

  // Search
  const q = $('#q');
  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    let any = false;
    $$('.cat').forEach((sec) => {
      let visible = 0;
      $$('.card', sec).forEach((c) => {
        const show = !term || c.dataset.search.includes(term);
        c.classList.toggle('hidden', !show);
        if (show) visible++;
      });
      sec.classList.toggle('hidden', visible === 0);
      if (visible) any = true;
    });
    $('#no-results').hidden = any || !$$('.cat').length;
    const feat = $('#featured');
    if (feat) feat.classList.toggle('hidden', !!term);
  });

  // Highlight the category chip for the section in view
  const chips = $('#chips');
  if (chips && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = en.target.dataset.cat;
          $$('.chip', chips).forEach((c) => {
            const active = c.dataset.cat === id;
            c.classList.toggle('active', active);
            if (active) c.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          });
        }
      },
      { rootMargin: '-140px 0px -60% 0px' }
    );
    $$('.cat').forEach((s) => io.observe(s));
  }

  // Share the store link (native share sheet on phones, copy elsewhere).
  const shareBtn = $('#share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      try {
        if (navigator.share) await navigator.share({ title: shop.name, url });
        else {
          await navigator.clipboard.writeText(url);
          toast(t.linkCopied);
        }
      } catch { /* cancelled */ }
    });
  }

  // Hairline under the toolbar once it sticks.
  const toolbar = $('.toolbar');
  const onScroll = () => toolbar.classList.toggle('stuck', toolbar.getBoundingClientRect().top <= 0 && scrollY > 0);
  addEventListener('scroll', onScroll, { passive: true });

  // Live preview from the admin's appearance screen (same origin only).
  if (D.preview) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'dukkan-preview') return;
      const d = e.data;
      if (d.theme) document.body.className = document.body.className.replace(/theme-\w+/, `theme-${d.theme}`);
      if (d.color) document.documentElement.style.setProperty('--brand', d.color);
      if (d.fontStack) document.documentElement.style.setProperty('--font', d.fontStack);
      if (d.fontHref) $('#font-css').href = d.fontHref;
      if ('logo' in d) $('#logo').innerHTML = d.logo ? `<img src="${esc(d.logo)}" alt="">` : `<span>${esc((shop.name || '?').charAt(0).toUpperCase())}</span>`;
      if ('cover' in d) {
        const cover = $('#cover');
        cover.classList.toggle('has-img', !!d.cover);
        const img = $('img', cover);
        if (d.cover) {
          if (img) img.src = d.cover;
          else cover.insertAdjacentHTML('afterbegin', `<img src="${esc(d.cover)}" alt="">`);
        } else if (img) img.remove();
      }
    });
    // Links shouldn't navigate away inside the preview frame.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && !a.getAttribute('href').startsWith('#')) e.preventDefault();
    }, true);
  }

  // Language menu keeps other query params (e.g. ?table=4).
  const langSel = $('#lang');
  if (langSel) {
    langSel.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('lang', langSel.value);
      location.href = url.toString();
    });
  }

  renderCartBar();
  showPaymentResult();
})();
