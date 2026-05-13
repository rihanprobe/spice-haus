/* ============================================================
   Spice Haus — main.js
   Single-item ordering flow: form → Google Sheets → WhatsApp
   ============================================================ */

const CONFIG = {
  // WhatsApp business number (digits only, with country code, no '+').
  // Currently: +971 52 471 8286
  WA_NUMBER: '971524718286',

  // TODO: Paste your Google Apps Script Web App URL here.
  // Setup steps are in the README / chat. Leave empty to skip Sheets capture
  // (form will still open WhatsApp).
  SHEET_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbzcuImZ3oWI9zp_05lwxKWuYV1NE8hYfuIBWv_AAVoW1oXchj1TxTnp2BATBgsa8BsX/exec',

  // Pricing — AED per kg, by meat type
  PRICES: { Beef: 185, Mutton: 205 },

  // 24-hour rule cutoff (Asia/Dubai local hour).
  // If you order BEFORE this hour, the earliest available date is tomorrow.
  // If you order AT or AFTER this hour, the earliest available date is day after tomorrow.
  CUTOFF_HOUR_DUBAI: 17,

  TIMEZONE: 'Asia/Dubai',
};

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function formatDateDubai(date) {
  // YYYY-MM-DD in Asia/Dubai
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

function getDubaiHour(date) {
  return parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.TIMEZONE, hour: '2-digit', hour12: false
  }).format(date), 10);
}

function addDaysISO(isoDate, days) {
  // isoDate = 'YYYY-MM-DD'
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

/* ------------------------------------------------------------
   Header — scroll state + mobile nav
   ------------------------------------------------------------ */

function initHeader() {
  const header = $('#siteHeader');
  const toggle = $('#navToggle');
  const links  = $('#navLinks');

  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    // close on link click
    $$('a', links).forEach(a => a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }
}

/* ------------------------------------------------------------
   Scroll-spy nav highlight + reveal-on-scroll
   ------------------------------------------------------------ */

function initScrollSpy() {
  const sections = $$('section[id]');
  const navLinks = $$('#navLinks a[href^="#"]');
  if (!sections.length || !navLinks.length) return;

  const setActive = id => {
    navLinks.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
    });
  };

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) setActive(e.target.id);
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

  sections.forEach(s => io.observe(s));
}

function initReveal() {
  const els = $$('.reveal, [data-reveal]');
  if (!els.length) return;

  // Respect reduced motion: just show everything.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    els.forEach(el => el.classList.add('in'));
    return;
  }

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

  els.forEach(el => io.observe(el));

  // Safety net: if any element is still hidden after 2.5s
  // (e.g. slow IO, headless screenshot tools, etc), just reveal it.
  setTimeout(() => {
    els.forEach(el => {
      if (!el.classList.contains('in')) el.classList.add('in');
    });
  }, 2500);
}

/* ------------------------------------------------------------
   FAQ accordion
   ------------------------------------------------------------ */

function initFAQ() {
  $$('.faq-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      if (!item) return;
      const willOpen = !item.classList.contains('open');
      // close others
      $$('.faq-item.open').forEach(i => {
        if (i !== item) {
          i.classList.remove('open');
          const b = $('.faq-q', i);
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));
    });
  });
}

/* ------------------------------------------------------------
   WhatsApp links — populate from CONFIG
   ------------------------------------------------------------ */

function initWaLinks() {
  const url = `https://wa.me/${CONFIG.WA_NUMBER}`;
  $$('[data-wa]').forEach(a => {
    // Only set href on actual link/anchor elements
    if (a.tagName === 'A') a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
  });
}

/* ------------------------------------------------------------
   Modal — open / close
   ------------------------------------------------------------ */

const Modal = (() => {
  const modal = $('#orderModal');
  const closeBtn = $('#closeModal');
  let lastFocus = null;

  function open() {
    if (!modal) return;
    lastFocus = document.activeElement;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    // refresh the date min every time we open
    applyDateMin();
    setTimeout(() => {
      const first = $('#o-name', modal);
      if (first) first.focus();
    }, 50);
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function init() {
    if (!modal) return;
    $$('[data-open-order]').forEach(b => b.addEventListener('click', open));
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });
  }

  return { init, open, close };
})();

/* ------------------------------------------------------------
   24-hour date rule
   ------------------------------------------------------------ */

function applyDateMin() {
  const input = $('#o-date');
  const help  = $('#dateHelp');
  if (!input) return;

  const now = new Date();
  const hour = getDubaiHour(now);
  const todayDubai = formatDateDubai(now);

  // If current Dubai time < cutoff → tomorrow is OK (>= 24h ahead by end of day-ish)
  // If current Dubai time >= cutoff → bump to day after tomorrow
  const offset = hour < CONFIG.CUTOFF_HOUR_DUBAI ? 1 : 2;
  const minDate = addDaysISO(todayDubai, offset);

  input.min = minDate;
  // If current value is before min, clear it
  if (input.value && input.value < minDate) input.value = '';
  // Default the value to minDate for convenience
  if (!input.value) input.value = minDate;

  if (help) {
    help.textContent = `Earliest available: ${prettyDate(minDate)} (24-hour notice required).`;
  }
}

/* ------------------------------------------------------------
   Pickup / Delivery toggle + live totals
   ------------------------------------------------------------ */

function getSelectedMeat() {
  const checked = document.querySelector('input[name="meat"]:checked');
  return checked ? checked.value : 'Beef';
}

function initOrderForm() {
  const qty       = $('#o-qty');
  const pickup    = $('#m-pickup');
  const delivery  = $('#m-delivery');
  const meatRadios = $$('input[name="meat"]');
  const addrField = $('#addressField');
  const addrInput = $('#o-address');
  const sumQty    = $('#sum-qty');
  const sumMeat   = $('#sum-meat');
  const sumSub    = $('#sum-subtotal');
  const sumTotal  = $('#sum-total');
  const sumDelRow = $('#sum-delivery-row');

  function recalc() {
    const q = parseInt(qty?.value || '1', 10);
    const meat = getSelectedMeat();
    const price = CONFIG.PRICES[meat] || CONFIG.PRICES.Beef;
    const subtotal = q * price;
    if (sumQty)   sumQty.textContent   = q;
    if (sumMeat)  sumMeat.textContent  = meat;
    if (sumSub)   sumSub.textContent   = subtotal;
    if (sumTotal) sumTotal.textContent = subtotal;
  }

  function syncMethod() {
    const isDelivery = !!(delivery && delivery.checked);
    if (addrField) addrField.hidden = !isDelivery;
    if (addrInput) {
      addrInput.required = isDelivery;
      if (!isDelivery) addrInput.value = '';
    }
    if (sumDelRow) sumDelRow.hidden = !isDelivery;
  }

  qty?.addEventListener('change', recalc);
  qty?.addEventListener('input',  recalc);
  pickup?.addEventListener('change', syncMethod);
  delivery?.addEventListener('change', syncMethod);
  meatRadios.forEach(r => r.addEventListener('change', recalc));

  recalc();
  syncMethod();
  applyDateMin();
}

/* ------------------------------------------------------------
   Submit → Google Sheets → WhatsApp
   ------------------------------------------------------------ */

function showError(msg) {
  const el = $('#formError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function clearError() {
  const el = $('#formError');
  if (!el) return;
  el.textContent = '';
  el.classList.remove('show');
}

function validateOrder(data) {
  if (!data.name || data.name.length < 2)      return 'Please enter your name.';
  if (!data.phone || data.phone.replace(/\D/g, '').length < 7) return 'Please enter a valid WhatsApp number.';
  if (!data.meat || !CONFIG.PRICES[data.meat]) return 'Please choose beef or mutton.';
  if (!data.quantity || data.quantity < 1)     return 'Please choose a quantity.';
  if (!data.date)                              return 'Please pick a date.';
  // Re-enforce 24h rule defensively
  const minDate = $('#o-date')?.min;
  if (minDate && data.date < minDate)          return `Earliest available date is ${prettyDate(minDate)} (24-hour notice).`;
  if (data.method === 'Delivery' && (!data.address || data.address.trim().length < 8)) {
    return 'Please enter a delivery address.';
  }
  return null;
}

function collectOrder() {
  const qty = parseInt($('#o-qty').value || '1', 10);
  const method = $('#m-delivery').checked ? 'Delivery' : 'Pickup';
  const meat = getSelectedMeat();
  const price = CONFIG.PRICES[meat] || CONFIG.PRICES.Beef;
  const rawDate = $('#o-date').value;
  return {
    name:     $('#o-name').value.trim(),
    phone:    $('#o-phone').value.trim(),
    meat,
    price_per_kg: price,
    pricePerKg: price,
    quantity: qty,
    method,
    address:  method === 'Delivery' ? $('#o-address').value.trim() : '',
    date:     rawDate ? prettyDate(rawDate) : '',
    notes:    $('#o-notes').value.trim(),
    subtotal: qty * price,
    total:    qty * price,
    currency: 'AED',
    source:   'spicehaus.org',
    submitted_at: new Date().toISOString(),
  };
}

function buildWaMessage(o) {
  const lines = [
    `*New Spice Haus Order*`,
    ``,
    `*Name:* ${o.name}`,
    `*Phone:* ${o.phone}`,
    `*Order:* ${o.meat} Bhuna Gosht × ${o.quantity} kg (AED ${o.price_per_kg}/kg)`,
    `*Method:* ${o.method}`,
  ];
  if (o.method === 'Delivery' && o.address) {
    lines.push(`*Address:* ${o.address}`);
  }
  lines.push(`*Date:* ${prettyDate(o.date)}`);
  if (o.notes) lines.push(`*Notes:* ${o.notes}`);
  lines.push(``);
  lines.push(`*Subtotal:* AED ${o.subtotal}`);
  if (o.method === 'Delivery') lines.push(`*Delivery fee:* to be confirmed`);
  lines.push(`*Total:* AED ${o.total}${o.method === 'Delivery' ? ' + delivery' : ''}`);
  lines.push(``);
  lines.push(`Please confirm my order. Thank you.`);
  return lines.join('\n');
}

async function sendToSheet(order) {
  if (!CONFIG.SHEET_WEBHOOK_URL) return { skipped: true };
  try {
    // no-cors avoids preflight; Apps Script accepts text/plain body.
    await fetch(CONFIG.SHEET_WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(order),
    });
    return { ok: true };
  } catch (err) {
    console.warn('Sheets capture failed:', err);
    return { ok: false, error: err };
  }
}

function initSubmit() {
  const btn = $('#submitOrder');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    clearError();

    const order = collectOrder();
    const err = validateOrder(order);
    if (err) {
      showError(err);
      return;
    }

    btn.classList.add('btn-loading');
    btn.disabled = true;

    try {
      await sendToSheet(order);
    } catch (_) { /* non-blocking */ }

    const text = encodeURIComponent(buildWaMessage(order));
    const waUrl = `https://wa.me/${CONFIG.WA_NUMBER}?text=${text}`;

    btn.classList.remove('btn-loading');
    btn.disabled = false;

    // Open WhatsApp in a new tab; fall back to same tab
    const win = window.open(waUrl, '_blank', 'noopener');
    if (!win) window.location.href = waUrl;

    // Optional: close modal shortly after
    setTimeout(() => Modal.close(), 400);
  });
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initScrollSpy();
  initReveal();
  initFAQ();
  initWaLinks();
  Modal.init();
  initOrderForm();
  initSubmit();
});
