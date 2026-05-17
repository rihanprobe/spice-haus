/* Spice Haus Admin — vanilla JS */

const CONFIG = {
  WEBHOOK: 'https://script.google.com/macros/s/AKfycbzcuImZ3oWI9zp_05lwxKWuYV1NE8hYfuIBWv_AAVoW1oXchj1TxTnp2BATBgsa8BsX/exec',
  WA_BUSINESS: '971524718286',   // your WhatsApp Business number
  BIZ_NAME: 'Spice Haus',
  STORAGE_KEY: 'sh_admin_key_v1'
};

const $  = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

let state = {
  key: null,
  orders: [],
  expenses: [],
  today: null,
  currentOrder: null
};

/* ---------- Auth ---------- */
function loadKey() {
  state.key = localStorage.getItem(CONFIG.STORAGE_KEY) || null;
}
function saveKey(k) {
  state.key = k;
  localStorage.setItem(CONFIG.STORAGE_KEY, k);
}
function clearKey() {
  state.key = null;
  localStorage.removeItem(CONFIG.STORAGE_KEY);
}

async function tryLogin(pwd) {
  // Try a cheap admin endpoint
  const url = CONFIG.WEBHOOK + '?action=admin_today&key=' + encodeURIComponent(pwd);
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  const data = await res.json().catch(() => ({}));
  if (data && data.ok) {
    saveKey(pwd);
    state.today = data;
    return true;
  }
  throw new Error(data && data.error ? data.error : 'Wrong password');
}

/* ---------- API helpers ---------- */
async function apiGet(action) {
  const url = CONFIG.WEBHOOK + '?action=' + action + '&key=' + encodeURIComponent(state.key);
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiPost(payload) {
  // Apps Script POST doesn't like custom Content-Type with CORS; use text/plain
  const body = JSON.stringify(Object.assign({ key: state.key }, payload));
  const res = await fetch(CONFIG.WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    redirect: 'follow'
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------- Tabs ---------- */
function showTab(name) {
  $$('.tab').forEach(s => s.hidden = s.dataset.tab !== name);
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.go === name));
  if (name === 'today')    refreshToday();
  if (name === 'orders')   refreshOrders();
  if (name === 'expenses') refreshExpenses();
}

/* ---------- TODAY ---------- */
async function refreshToday() {
  try {
    const data = await apiGet('admin_today');
    state.today = data;
    $('#todayDate').textContent = formatDate(data.date);
    $('#kpiOrders').textContent   = data.orders_today;
    $('#kpiRevenue').textContent  = fmt(data.revenue_today);
    $('#kpiExpenses').textContent = fmt(data.expenses_today);
    $('#kpiNet').textContent      = fmt(data.net_today);
    $('#kpiCharity').textContent  = fmt(data.charity_today);
    $('#kpiPending').textContent  = data.orders_pending;
  } catch (e) {
    toast('Could not load today: ' + e.message);
  }
}

/* ---------- ORDERS ---------- */
async function refreshOrders() {
  $('#ordersList').innerHTML = '<div class="empty">Loading…</div>';
  try {
    const data = await apiGet('admin_orders');
    state.orders = data.orders || [];
    renderOrders();
  } catch (e) {
    $('#ordersList').innerHTML = '<div class="empty">Could not load orders: ' + escapeHtml(e.message) + '</div>';
  }
}

function renderOrders() {
  const q = ($('#orderSearch').value || '').trim().toLowerCase();
  const f = $('#orderStatusFilter').value;
  const list = state.orders.filter(o => {
    if (f && o.status !== f) return false;
    if (!q) return true;
    const hay = (o.first_name + ' ' + o.last_name + ' ' + o.phone + ' ' + o.order_number).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  if (!list.length) {
    $('#ordersList').innerHTML = '<div class="empty">No orders match.</div>';
    return;
  }
  $('#ordersList').innerHTML = list.map(o => `
    <div class="row" data-order="${escapeHtml(o.order_number)}">
      <div class="row-top">
        <div>
          <div class="row-name">${escapeHtml(o.first_name + ' ' + o.last_name).trim() || '—'}</div>
          <div class="row-meta">${escapeHtml(o.order_number)} · ${escapeHtml(o.phone)}</div>
        </div>
        <span class="pill ${cssClass(o.status)}">${escapeHtml(o.status || 'New')}</span>
      </div>
      <div class="row-meta">${escapeHtml(o.meat)} ${o.quantity}kg · ${escapeHtml(o.method)}${o.city ? ' · ' + escapeHtml(o.city) : ''}</div>
      <div class="row-foot">
        <span class="row-meta">${escapeHtml(cleanDate(o.date))}${o.time ? ' · ' + escapeHtml(cleanTime(o.time)) : ''}</span>
        <span class="row-amount">AED ${fmt(o.total)}</span>
      </div>
    </div>
  `).join('');
  $$('#ordersList .row').forEach(r => r.addEventListener('click', () => openOrder(r.dataset.order)));
}

/* ---------- ORDER DETAIL + WHATSAPP ---------- */
function openOrder(orderNumber) {
  const o = state.orders.find(x => x.order_number === orderNumber);
  if (!o) return;
  state.currentOrder = o;
  $('#om-title').textContent = (o.first_name + ' ' + o.last_name).trim() || o.order_number;
  $('#om-sub').textContent   = o.order_number + ' · ' + o.phone;

  const cleanedDate = cleanDate(o.date);
  const cleanedTime = cleanTime(o.time);
  const kv = [
    ['Meat',      `${o.meat} · ${o.quantity}kg @ AED ${fmt(o.price_per_kg)}/kg`],
    ['Method',    o.method + (o.city ? ' · ' + o.city : '')],
    ['Address',   o.address || '—'],
    ['When',      `${cleanedDate}${cleanedTime ? ' · ' + cleanedTime : ''}`.trim() || '—'],
    ['Notes',     o.notes || '—'],
    ['Delivery fee', 'AED ' + fmt(o.delivery_fee)],
    ['Total',     'AED ' + fmt(o.total)]
  ];
  $('#om-details').innerHTML = kv.map(([k, v]) =>
    `<div class="row-kv"><b>${k}</b><span>${escapeHtml(v)}</span></div>`
  ).join('');

  $('#om-status').value = o.status || 'New';

  // Render WhatsApp templates
  const tpls = [
    ['Confirm order', confirmTemplate(o)],
    ['Ask payment',   paymentTemplate(o)],
    ['Ready for pickup', readyPickupTemplate(o)],
    ['Out for delivery', outForDeliveryTemplate(o)],
    ['Delivered — thank you', thankYouTemplate(o)],
    ['Follow-up next week', followUpTemplate(o)]
  ];
  $('#om-templates').innerHTML = tpls.map(([label, msg], i) =>
    `<button type="button" class="btn ghost" data-msg-i="${i}">${label}</button>`
  ).join('');
  $$('#om-templates .btn').forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.msgI, 10);
    openWhatsApp(o.phone, tpls[i][1]);
  }));

  $('#om-custom').value = '';
  openModal('#orderModal');
}

function openWhatsApp(phone, message) {
  const digits = (phone || '').replace(/\D/g, '');
  const url = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
  window.open(url, '_blank', 'noopener');
}

/* WhatsApp templates (English; you can edit any time) */
function greet(o)  { return `Hi ${o.first_name || 'there'},`; }
function bizSig()  { return `\n\n— ${CONFIG.BIZ_NAME}`; }

/* Strip any raw "Date" / "GMT" / Arabic timezone tail that may sneak through
   if the Sheet returned a Date object. Also remove "(توقيت الخليج)" tails. */
function cleanDate(s) {
  if (!s) return '';
  s = String(s);
  // Pattern: "Mon May 18 2026 04:00:00 GMT+0400 (توقيت الخليج)"
  const d = new Date(s);
  if (!isNaN(d) && /GMT|\d{4}/.test(s) && /\(/.test(s)) {
    return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }
  // Strip stray "GMT+0400 (توقيت الخليج)" tails just in case
  return s.replace(/\s*GMT[^()]*\([^)]*\)\s*$/, '').trim();
}
function cleanTime(s) {
  if (!s) return '';
  s = String(s);
  const d = new Date(s);
  if (!isNaN(d) && /GMT|\d{4}/.test(s) && /\(/.test(s)) {
    return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return s.replace(/\s*GMT[^()]*\([^)]*\)\s*$/, '').trim();
}

function confirmTemplate(o) {
  const date = cleanDate(o.date);
  const time = cleanTime(o.time);
  return `${greet(o)}\n\nWe've received your payment — thank you! 🙏\n\nYour order *${o.order_number}* is confirmed:\n\n• ${o.meat} — ${o.quantity}kg\n• ${o.method}${o.city ? ' to ' + o.city : ''}\n• ${date}${time ? ' at ' + time : ''}\n• Total: AED ${fmt(o.total)}\n\nWe'll start your slow-cooked bhuna and message you the moment it's ready.${bizSig()}`;
}
function paymentTemplate(o) {
  return `${greet(o)}\n\nTo confirm your order ${o.order_number} (AED ${fmt(o.total)}), please transfer the amount to:\n\n🏦 *The National Bank of Ras Al Khaimah (P.S.C.)*\nName: Mohamed Rihan Abdul Karim Rihan Abdul Karim Chougle\nAccount: 0372011779001\nIBAN: AE74 0400 0003 7201 1779 001\nSWIFT: NRAKAEAK\n\nKindly share the payment screenshot once done — your bhuna will be on the way shortly.\n\nThank you 🙏${bizSig()}`;
}
function readyPickupTemplate(o) {
  const time = cleanTime(o.time);
  return `${greet(o)}\n\nYour ${o.meat.toLowerCase()} bhuna (${o.quantity}kg) is freshly cooked and ready for pickup${time ? ' at your scheduled time of *' + time + '*' : ''}.\n\nSee you soon!${bizSig()}`;
}
function outForDeliveryTemplate(o) {
  const time = cleanTime(o.time);
  return `${greet(o)}\n\nYour order *${o.order_number}* is on the way to ${o.city || 'you'}${time ? ' for ' + time : ''}. ETA in ~30 minutes.\n\nDriver will WhatsApp you on arrival.${bizSig()}`;
}
function thankYouTemplate(o) {
  return `${greet(o)}\n\nHope you enjoyed your bhuna gosht. A reminder — 10% of every order goes back to those in need.\n\nIf you loved it, a quick reply or share on Instagram would mean the world. Order again any time at https://spicehaus.org${bizSig()}`;
}
function followUpTemplate(o) {
  return `${greet(o)}\n\nA quick hello from our kitchen — we hope you and your family are doing well.\n\nNo occasion, just wanted to thank you again for trusting us with your last meal. It meant a lot.\n\nWhenever you'd like us to cook for you again, we're here.\n\nWarmly,\nSpice Haus`;
}

/* Custom message */
function bindOrderModal() {
  $('#om-save-status').addEventListener('click', async () => {
    const o = state.currentOrder;
    if (!o) return;
    const status = $('#om-status').value;
    try {
      await apiPost({ action: 'admin_update_status', order_number: o.order_number, status });
      o.status = status;
      toast('Status updated');
      renderOrders();
    } catch (e) {
      toast('Update failed: ' + e.message);
    }
  });

  $('#om-send-custom').addEventListener('click', () => {
    const o = state.currentOrder;
    const msg = ($('#om-custom').value || '').trim();
    if (!o || !msg) { toast('Type a message first'); return; }
    openWhatsApp(o.phone, msg);
  });
}

/* ---------- EXPENSES ---------- */
async function refreshExpenses() {
  $('#expensesList').innerHTML = '<div class="empty">Loading…</div>';
  try {
    const data = await apiGet('admin_expenses');
    state.expenses = data.expenses || [];
    renderExpenses();
  } catch (e) {
    $('#expensesList').innerHTML = '<div class="empty">Could not load expenses: ' + escapeHtml(e.message) + '</div>';
  }
}
function renderExpenses() {
  if (!state.expenses.length) {
    $('#expensesList').innerHTML = '<div class="empty">No expenses yet. Tap + Add to record one.</div>';
    return;
  }
  $('#expensesList').innerHTML = state.expenses.map(e => `
    <div class="row">
      <div class="row-top">
        <div>
          <div class="row-name">${escapeHtml(e.category)}${e.vendor ? ' · ' + escapeHtml(e.vendor) : ''}</div>
          <div class="row-meta">${escapeHtml(e.expense_id)} · ${escapeHtml(e.date)}</div>
        </div>
        <span class="row-amount">AED ${fmt(e.amount)}</span>
      </div>
      ${e.notes ? `<div class="row-meta">${escapeHtml(e.notes)}</div>` : ''}
      ${e.receipt_url ? `<div><a href="${escapeHtml(e.receipt_url)}" target="_blank" rel="noopener" class="row-meta">📎 View receipt</a></div>` : ''}
    </div>
  `).join('');
}

/* ---------- EXPENSE MODAL ---------- */
function bindExpenseForm() {
  $('#newExpenseBtn').addEventListener('click', () => {
    $('#ex-date').value = todayISO();
    $('#ex-amount').value = '';
    $('#ex-vendor').value = '';
    $('#ex-notes').value = '';
    $('#ex-receipt').value = '';
    $('#ex-receipt-preview').hidden = true;
    $('#ex-receipt-preview').innerHTML = '';
    $('#expenseErr').hidden = true;
    openModal('#expenseModal');
  });

  $('#ex-receipt').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { $('#ex-receipt-preview').hidden = true; return; }
    const reader = new FileReader();
    reader.onload = () => {
      $('#ex-receipt-preview').innerHTML = `<img src="${reader.result}" alt="">`;
      $('#ex-receipt-preview').hidden = false;
    };
    reader.readAsDataURL(file);
  });

  $('#expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#expenseErr').hidden = true;
    const date     = $('#ex-date').value;
    const category = $('#ex-category').value;
    const amount   = parseFloat($('#ex-amount').value);
    const vendor   = $('#ex-vendor').value.trim();
    const notes    = $('#ex-notes').value.trim();
    if (!date || !category || isNaN(amount) || amount < 0) {
      showErr('#expenseErr', 'Date, category and a valid amount are required.');
      return;
    }
    const file = $('#ex-receipt').files && $('#ex-receipt').files[0];

    const btn = $('#ex-save');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      const payload = { action: 'admin_add_expense', date, category, amount, vendor, notes };
      if (file) {
        const b64 = await fileToBase64(file);
        payload.receipt_b64 = b64;
        payload.receipt_name = file.name;
        payload.receipt_mime = file.type || 'image/jpeg';
      }
      await apiPost(payload);
      toast('Expense saved');
      closeModal('#expenseModal');
      refreshExpenses();
      // refresh today KPIs if visible
      if (!$('[data-tab="today"]').hidden) refreshToday();
    } catch (err) {
      showErr('#expenseErr', err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save expense';
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const result = reader.result || '';
      const i = String(result).indexOf(',');
      resolve(i >= 0 ? String(result).slice(i + 1) : String(result));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- Modal helpers ---------- */
function openModal(sel)  { $(sel).hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(sel) { $(sel).hidden = true;  document.body.style.overflow = ''; }
function bindModalClose() {
  $$('[data-close-modal]').forEach(el => el.addEventListener('click', () => {
    const m = el.closest('.modal'); if (m) closeModal('#' + m.id);
  }));
}

/* ---------- Utilities ---------- */
function fmt(n) { const x = Number(n || 0); return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatDate(yyyy_mm_dd) {
  const d = new Date(yyyy_mm_dd + 'T00:00:00');
  if (isNaN(d)) return yyyy_mm_dd;
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function todayISO() {
  const d = new Date();
  const tz = 'Asia/Dubai';
  // Get Dubai date parts
  const opts = { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', opts).format(d); // yyyy-mm-dd
  return parts;
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function cssClass(s) { return String(s || 'New').replace(/[^a-zA-Z]/g, ''); }
function showErr(sel, msg) { const el = $(sel); el.textContent = msg; el.hidden = false; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ---------- Init ---------- */
function init() {
  loadKey();

  // Login
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = $('#adminPwd').value;
    const errEl = $('#loginErr');
    errEl.hidden = true;
    try {
      await tryLogin(pwd);
      enterApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  // Sign out
  document.addEventListener('click', (e) => {
    if (e.target.id === 'logoutBtn') { clearKey(); location.reload(); }
  });

  // Tab nav (bottom bar + quick-add)
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (!t) return;
    const name = t.dataset.go;
    if (['today','orders','expenses'].indexOf(name) >= 0) showTab(name);
  });

  // Order filters
  $('#orderSearch').addEventListener('input', renderOrders);
  $('#orderStatusFilter').addEventListener('change', renderOrders);

  bindModalClose();
  bindExpenseForm();
  bindOrderModal();

  // Auto-enter if we already have a key
  if (state.key) {
    enterApp(/*skipVerify*/ false);
  }
}

async function enterApp() {
  // Verify the saved key works (in case it changed)
  try {
    await apiGet('admin_today');
  } catch (e) {
    clearKey();
    return; // stay on login screen
  }
  $('#loginScreen').hidden = true;
  $('#appShell').hidden = false;
  showTab('today');
}

document.addEventListener('DOMContentLoaded', init);
