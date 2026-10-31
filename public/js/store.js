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
  const deliveryFee = (method, sub) => {
    if (method !== 'delivery') return 0;
    if (shop.freeDeliveryOver > 0 && sub >= shop.freeDeliveryOver) return 0;
    return shop.deliveryFee;
  };

  function saveCart() {
    storage.set(CART_KEY, cart);
    renderCartBar();
  }

  function addToCart(id, variant, qty) {
    const key = `${id}|${variant || ''}`;
    const line = cart.find((l) => `${l.id}|${l.variant || ''}` === key);
    if (line) line.qty += qty;
    else cart.push({ id, variant: variant || '', qty });
    saveCart();
    const bar = $('#cartbar button');
    bar.classList.remove('bump');
    void bar.offsetWidth;
    bar.classList.add('bump');
    toast(`✓ ${products.get(id).name}`);
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
    el.textContent = msg;
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
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeSheet();
  });

  const thumbHtml = (p) =>
    p.image ? `<img src="${esc(p.image)}" alt="">` : `<span class="emoji">${esc(p.emoji || p.name.charAt(0))}</span>`;

  // ---------- product sheet ----------
  function openProduct(id) {
    const p = products.get(id);
    if (!p) return;
    let qty = 1;
    const hasVariants = p.variants.length > 0;
    const html = `
      <div class="p-hero">${thumbHtml(p)}</div>
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
            <div class="stepper"><button type="button" data-q="-1" aria-label="-">−</button><span id="pq">1</span><button type="button" data-q="1" aria-label="+">+</button></div>
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
        addToCart(p.id, selected(), qty);
        closeSheet();
      });
      update();
    });
  }

  // ---------- cart / checkout sheet ----------
  function openCart() {
    const saved = storage.get(CUSTOMER_KEY, {});
    let method = shop.methods.includes(saved.method) ? saved.method : shop.methods[0];
    if (D.table && shop.methods.includes('dineIn')) method = 'dineIn';

    const html = `
      <h2 id="sheet-title">${esc(t.cart)}</h2>
      <ul class="lines" id="lines"></ul>
      <div id="checkout">
        ${shop.methods.length > 1
          ? `<div class="field"><span>${esc(t.orderMethod)}</span><div class="methods">${shop.methods
              .map((m) => `<label><input type="radio" name="method" value="${m}" ${m === method ? 'checked' : ''}>${esc(t[m])}</label>`)
              .join('')}</div></div>`
          : ''}
        <form id="form" novalidate>
          <label class="field"><span>${esc(t.yourName)} *</span><input name="name" autocomplete="name" required maxlength="80" value="${esc(saved.name || '')}"></label>
          <label class="field" data-for="delivery pickup"><span>${esc(t.yourPhone)} *</span><input name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(saved.phone || '')}"></label>
          <label class="field" data-for="delivery"><span>${esc(t.address)} *</span><textarea name="address" rows="2" autocomplete="street-address" maxlength="300">${esc(saved.address || '')}</textarea></label>
          <label class="field" data-for="dineIn"><span>${esc(t.table)} *</span><input name="table" inputmode="numeric" maxlength="20" value="${esc(D.table || '')}"></label>
          <label class="field"><span>${esc(t.notes)}</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>
          <div class="summary" id="summary"></div>
          <div id="minwarn"></div>
          <button class="btn wa" type="submit" id="send">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a8.2 8.2 0 0 1-2.4-1.5 9 9 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.6l.4-.5.3-.5v-.5c0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 0 0-.8.4 3.4 3.4 0 0 0-1 2.5 5.9 5.9 0 0 0 1.2 3.1 13.5 13.5 0 0 0 5.2 4.6c1.9.8 2.7.9 3.6.8a3.1 3.1 0 0 0 2-1.4 2.5 2.5 0 0 0 .2-1.4c-.1-.2-.3-.2-.6-.4zM12 21.8a9.9 9.9 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8zM12 0a12 12 0 0 0-10.3 18L0 24l6.2-1.6A12 12 0 1 0 12 0z"/></svg>
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
              <div class="l-name"><b>${esc(p.name)}</b>${l.variant ? `<small>${esc(l.variant)}</small>` : ''}</div>
              <div class="stepper"><button type="button" data-line="${i}" data-d="-1" aria-label="-">${l.qty === 1 ? '🗑' : '−'}</button><span>${l.qty}</span><button type="button" data-line="${i}" data-d="1" aria-label="+">+</button></div>
              <div class="l-price">${esc(money(unitPrice(l) * l.qty))}</div>
            </li>`;
          })
          .join('');
        const sub = subtotal();
        const fee = deliveryFee(method, sub);
        $('#summary', root).innerHTML = `
          <div><span>${esc(t.subtotal)}</span><span>${esc(money(sub))}</span></div>
          ${method === 'delivery' ? `<div><span>${esc(t.deliveryFee)}</span><span>${fee ? esc(money(fee)) : esc(t.free)}</span></div>` : ''}
          <div class="total"><span>${esc(t.total)}</span><span>${esc(money(sub + fee))}</span></div>`;
        const below = shop.minOrder > 0 && sub < shop.minOrder;
        $('#minwarn', root).innerHTML = below ? `<p class="warn">${esc(t.minOrder)}: ${esc(money(shop.minOrder))}</p>` : '';
        $('#send', root).disabled = below || !shop.acceptingOrders;
        if (!shop.acceptingOrders) $('#err', root).textContent = t.closed;
      };

      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-line]');
        if (!b) return;
        const line = cart[Number(b.dataset.line)];
        line.qty += Number(b.dataset.d);
        if (line.qty <= 0) cart.splice(Number(b.dataset.line), 1);
        saveCart();
        renderLines();
      });

      root.addEventListener('change', (e) => {
        if (e.target.name === 'method') {
          method = e.target.value;
          applyMethod();
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
        const missing = need.find((k) => !String(f[k] || '').trim());
        if (missing) {
          err.textContent = `${t.required}: ${t[{ name: 'yourName', phone: 'yourPhone', address: 'address', table: 'table' }[missing]]}`;
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
              customer: { name: f.name, phone: f.phone, address: f.address, notes: f.notes },
            }),
          });
          const data = await res.json();
          if (!res.ok) throw Object.assign(new Error(data.error), { code: data.error });
          storage.set(CUSTOMER_KEY, { name: f.name, phone: f.phone, address: f.address, method });
          cart = [];
          saveCart();
          showDone(data);
          // New tab keeps the confirmation visible; fall back if popups are blocked.
          // ('noopener' would make window.open return null, so detach manually.)
          const win = window.open(data.whatsappUrl, '_blank');
          if (win) win.opener = null;
          else window.location.href = data.whatsappUrl;
        } catch (ex) {
          const messages = { closed: t.closed, below_minimum: `${t.minOrder}: ${money(shop.minOrder)}` };
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
        <div class="big">🎉</div>
        <h2 id="sheet-title">${esc(t.orderSent)}</h2>
        <div class="no">${esc(t.orderNo)} #${esc(data.no)} · ${esc(money(data.total))}</div>
        <p class="muted">${esc(t.orderSentHint)}</p>
        <a class="btn wa" href="${esc(data.whatsappUrl)}" target="_blank" rel="noopener">${esc(t.openWhatsApp)}</a>
        <button class="btn ghost" type="button" data-close>${esc(t.backToMenu)}</button>
      </div>`);
  }

  // ---------- menu interactions ----------
  $('#menu').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.stopPropagation();
      const p = products.get(add.dataset.add);
      if (p.variants.length) openProduct(p.id);
      else addToCart(p.id, '', 1);
      return;
    }
    const card = e.target.closest('.card');
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

  renderCartBar();
})();
