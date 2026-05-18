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
  currentOrder: null,
  currentCustomer: null,
  customerSort: 'spend',  // 'spend' | 'recent' | 'count' | 'name'
  customerQuery: '',
  reportRange: 'this_week', // 'this_week'|'last_week'|'this_month'|'last_month'|'ytd'|'custom'
  reportCustom: { from: null, to: null }, // ISO yyyy-mm-dd
  quickFilter: 'all'   // 'all' | 'unpaid' | 'today' | 'ready' | 'out' | 'stale'
};

/* Reminder thresholds (hours) */
const REMINDER_STALE_HOURS  = 12;   // unpaid OR unconfirmed older than this → ⏰ stale
const REMINDER_URGENT_HOURS = 24;   // delivery within this AND still unpaid → 🚨 urgent

/* Compute staleness for an order. Returns 'urgent' | 'stale' | null.
   - urgent: delivery is within REMINDER_URGENT_HOURS AND payment not Received
   - stale:  order older than REMINDER_STALE_HOURS AND (unpaid or unconfirmed) */
function staleness(o) {
  const pay = o.payment_status || 'Pending';
  const del = o.delivery_status || o.status || 'New';
  if (del === 'Delivered' || del === 'Cancelled') return null;

  const now = Date.now();
  const isUnpaid       = pay !== 'Received';
  const isUnconfirmed  = (del === 'New' || del === 'Confirmed');

  // urgent: delivery datetime within next 24h AND still unpaid
  const deliveryAt = parseOrderDateTime(o.date, o.time);
  if (deliveryAt && isUnpaid) {
    const diffH = (deliveryAt - now) / 36e5;
    if (diffH >= -1 && diffH <= REMINDER_URGENT_HOURS) return 'urgent';
  }

  // stale: order placed > 12h ago AND still unpaid OR unconfirmed
  const placedAt = o.timestamp ? new Date(o.timestamp).getTime() : NaN;
  if (!isNaN(placedAt) && (now - placedAt) / 36e5 > REMINDER_STALE_HOURS && (isUnpaid || isUnconfirmed)) {
    return 'stale';
  }
  return null;
}

/* Parse the sheet's Date + Time fields into a single ms timestamp in Dubai-local time.
   Returns NaN-equivalent (null) if it can't parse. */
function parseOrderDateTime(dateField, timeField) {
  if (!dateField) return null;
  const ymd = isoFromDateField(dateField);
  if (!ymd) return null;
  // time field could be 'HH:MM', '19:00', '7:00 PM', or a full Date string
  let hh = 12, mm = 0;
  if (timeField) {
    const s = String(timeField);
    const m = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm|AM|PM)?/);
    if (m) {
      hh = parseInt(m[1], 10);
      mm = parseInt(m[2], 10);
      const ap = (m[3] || '').toLowerCase();
      if (ap === 'pm' && hh < 12) hh += 12;
      if (ap === 'am' && hh === 12) hh = 0;
    } else {
      const d = new Date(s);
      if (!isNaN(d)) {
        // Use Dubai-local hours/minutes from the parsed Date
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
        const hp = parts.find(p => p.type === 'hour'); const mp = parts.find(p => p.type === 'minute');
        if (hp) hh = parseInt(hp.value, 10);
        if (mp) mm = parseInt(mp.value, 10);
      }
    }
  }
  // Build an ISO string in Dubai offset (+04:00, no DST in UAE)
  const iso = `${ymd}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+04:00`;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

/* Quick-filter predicate */
function matchesQuickFilter(o, qf) {
  const pay = o.payment_status || 'Pending';
  const del = o.delivery_status || o.status || 'New';
  if (qf === 'all') return true;
  if (qf === 'unpaid') return pay !== 'Received' && del !== 'Cancelled';
  if (qf === 'today') {
    const today = todayISO();
    const orderDate = isoFromDateField(o.date);
    return orderDate === today && del !== 'Cancelled';
  }
  if (qf === 'ready') return del === 'Ready';
  if (qf === 'out')   return del === 'Out for delivery';
  if (qf === 'stale') return staleness(o) !== null;
  return true;
}

/* Parse various date formats from the sheet into YYYY-MM-DD (Dubai time) */
function isoFromDateField(s) {
  if (!s) return '';
  s = String(s);
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d)) return '';
  const opts = { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('en-CA', opts).format(d);
}

function updateQuickFilterCounts() {
  const counts = { all: 0, unpaid: 0, today: 0, ready: 0, out: 0, stale: 0, urgent: 0 };
  state.orders.forEach(o => {
    counts.all++;
    if (matchesQuickFilter(o, 'unpaid')) counts.unpaid++;
    if (matchesQuickFilter(o, 'today'))  counts.today++;
    if (matchesQuickFilter(o, 'ready'))  counts.ready++;
    if (matchesQuickFilter(o, 'out'))    counts.out++;
    const s = staleness(o);
    if (s) counts.stale++;
    if (s === 'urgent') counts.urgent++;
  });
  Object.keys(counts).forEach(k => {
    const el = document.querySelector(`[data-qf-count="${k}"]`);
    if (el) el.textContent = counts[k];
  });
  // Reminders banner
  const banner = document.getElementById('remindersBanner');
  const bText  = document.getElementById('rb-text');
  if (banner && bText) {
    if (counts.stale === 0) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.classList.toggle('urgent', counts.urgent > 0);
      const parts = [];
      if (counts.urgent > 0) parts.push(`🚨 ${counts.urgent} urgent (delivery within 24h, unpaid)`);
      const others = counts.stale - counts.urgent;
      if (others > 0) parts.push(`⏰ ${others} stale (>12h, unpaid or unconfirmed)`);
      bText.textContent = parts.join('  ·  ');
    }
  }
}

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
  if (name === 'today')     refreshToday();
  if (name === 'orders')    refreshOrders();
  if (name === 'customers') refreshCustomers();
  if (name === 'reports')   refreshReports();
  if (name === 'expenses')  refreshExpenses();
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
  updateQuickFilterCounts();
  const q = ($('#orderSearch').value || '').trim().toLowerCase();
  const f = $('#orderStatusFilter').value;
  const list = state.orders.filter(o => {
    if (!matchesQuickFilter(o, state.quickFilter)) return false;
    const ds = o.delivery_status || o.status || 'New';
    if (f && ds !== f) return false;
    if (!q) return true;
    const hay = (o.first_name + ' ' + o.last_name + ' ' + o.phone + ' ' + o.order_number).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  if (!list.length) {
    $('#ordersList').innerHTML = '<div class="empty">No orders match.</div>';
    return;
  }
  $('#ordersList').innerHTML = list.map(o => {
    const pay = o.payment_status || 'Pending';
    const del = o.delivery_status || o.status || 'New';
    const stale = staleness(o);     // null | 'stale' | 'urgent'
    const rowCls = 'row' + (stale ? ' is-' + stale : '');
    const stalePill = stale === 'urgent'
      ? '<span class="pill pill-urgent">🚨 Urgent</span>'
      : stale === 'stale' ? '<span class="pill pill-stale">⏰ Reminder</span>' : '';

    // Decide which quick-action to show as the primary green button
    let primary = '';
    if (pay !== 'Received') {
      primary = `<button type="button" class="qa-btn qa-pay" data-qa="mark_paid">✅ Mark Paid</button>`;
    } else if (del === 'New' || del === 'Confirmed') {
      primary = `<button type="button" class="qa-btn qa-ready" data-qa="mark_ready">🍲 Mark Ready</button>`;
    } else if (del === 'Ready') {
      const next = (o.method && o.method.toLowerCase().indexOf('deliver') >= 0) ? 'out_for_delivery' : 'mark_delivered';
      const label = next === 'out_for_delivery' ? '🚚 Out for delivery' : '📦 Mark Delivered';
      primary = `<button type="button" class="qa-btn qa-ready" data-qa="${next}">${label}</button>`;
    } else if (del === 'Out for delivery') {
      primary = `<button type="button" class="qa-btn qa-ready" data-qa="mark_delivered">📦 Mark Delivered</button>`;
    }

    return `
    <div class="${rowCls}" data-order="${escapeHtml(o.order_number)}">
      <div class="row-top">
        <div>
          <div class="row-name">${escapeHtml(o.first_name + ' ' + o.last_name).trim() || '—'}</div>
          <div class="row-meta">${escapeHtml(o.order_number)} · ${escapeHtml(o.phone)}</div>
        </div>
        <div class="pill-stack">
          ${stalePill}
          <span class="pill pay-${cssClass(pay)}">💰 ${escapeHtml(pay)}</span>
          <span class="pill ${cssClass(del)}">🚚 ${escapeHtml(del)}</span>
        </div>
      </div>
      <div class="row-meta">${escapeHtml(o.meat)} ${o.quantity}kg · ${escapeHtml(o.method)}${o.city ? ' · ' + escapeHtml(o.city) : ''}</div>
      <div class="row-foot">
        <span class="row-meta">${escapeHtml(cleanDate(o.date))}${o.time ? ' · ' + escapeHtml(cleanTime(o.time)) : ''}</span>
        <span class="row-amount">AED ${fmt(o.total)}</span>
      </div>
      ${primary ? `<div class="row-actions">${primary}<button type="button" class="qa-btn qa-ghost" data-qa="open">Details</button></div>` : ''}
    </div>`;
  }).join('');

  // Wire clicks
  $$('#ordersList .row').forEach(r => {
    r.addEventListener('click', (e) => {
      const qaEl = e.target.closest('.qa-btn');
      if (qaEl) {
        e.stopPropagation();
        const action = qaEl.dataset.qa;
        if (action === 'open') return openOrder(r.dataset.order);
        return quickAction(r.dataset.order, action, qaEl);
      }
      openOrder(r.dataset.order);
    });
  });
}

/* One-tap actions from the orders list */
async function quickAction(orderNumber, action, btn) {
  const o = state.orders.find(x => x.order_number === orderNumber);
  if (!o) return;

  let payload = { action: 'admin_update_status', order_number: orderNumber };
  let confirmMsg = '';
  let askRef = false;

  if (action === 'mark_paid') {
    askRef = true;
    payload.payment_status = 'Received';
    payload.delivery_status = (o.delivery_status === 'New' || !o.delivery_status) ? 'Confirmed' : o.delivery_status;
    confirmMsg = `Mark ${orderNumber} as PAID?\n\nThis will:\n• Set payment to Received\n• Move delivery to Confirmed (if still New)\n\nOptional: enter payment reference (transaction ID / last 4 digits) or leave blank.`;
  } else if (action === 'mark_ready') {
    payload.delivery_status = 'Ready';
    confirmMsg = `Mark ${orderNumber} as READY?`;
  } else if (action === 'out_for_delivery') {
    payload.delivery_status = 'Out for delivery';
    confirmMsg = `Mark ${orderNumber} as OUT FOR DELIVERY?`;
  } else if (action === 'mark_delivered') {
    payload.delivery_status = 'Delivered';
    confirmMsg = `Mark ${orderNumber} as DELIVERED?`;
  } else {
    return;
  }

  // Ask for payment ref on "Mark Paid"
  if (askRef) {
    const ref = window.prompt(confirmMsg, o.payment_ref || '');
    if (ref === null) return; // cancelled
    payload.payment_ref = (ref || '').trim();
  } else {
    if (!window.confirm(confirmMsg)) return;
  }

  const oldLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await apiPost(payload);
    // Update local state
    if (payload.payment_status)  o.payment_status  = payload.payment_status;
    if (payload.delivery_status) { o.delivery_status = payload.delivery_status; o.status = payload.delivery_status; }
    if (payload.payment_ref !== undefined) o.payment_ref = payload.payment_ref;
    toast('Updated — ' + orderNumber);
    renderOrders();
    refreshToday();
  } catch (e) {
    toast('Update failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = oldLabel; }
  }
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

  $('#om-payment-status').value  = o.payment_status  || 'Pending';
  $('#om-payment-ref').value     = o.payment_ref     || '';
  $('#om-delivery-status').value = o.delivery_status || o.status || 'New';

  // Render WhatsApp templates. Each entry: [label, message, gateFn(o), highlight?] where gateFn
  // returns a string warning if the template shouldn't be sent yet (null = OK).
  const paid = (o.payment_status === 'Received');
  const stale = staleness(o);
  const tpls = [
    ['Confirm order',        confirmTemplate(o),         () => paid ? null : 'Payment is still Pending. Are you sure you want to send the confirmation (which thanks the customer for paying)?'],
    [stale === 'urgent' ? '🚨 Urgent reminder' : '⏰ Send reminder',
                             reminderTemplate(o, stale), () => null,                                                                  !!stale],
    ['Ask payment',          paymentTemplate(o),         () => null],
    ['Ready for pickup',     readyPickupTemplate(o),     () => paid ? null : 'This customer has not paid yet. Send anyway?'],
    ['Out for delivery',     outForDeliveryTemplate(o),  () => paid ? null : 'This customer has not paid yet. Send anyway?'],
    ['Delivered — thank you', thankYouTemplate(o),        () => null],
    ['Follow-up next week',  followUpTemplate(o),        () => null]
  ];
  $('#om-templates').innerHTML = tpls.map(([label, msg, gateFn, highlight], i) => {
    const blocked = (i === 0) && !paid;  // Confirm order gets a soft-disabled look when unpaid
    let cls = 'btn ghost';
    if (blocked)   cls += ' tpl-gated';
    if (highlight) cls += ' tpl-highlight';
    const title = blocked ? 'Payment still pending — click to override' : '';
    return `<button type="button" class="${cls}" data-msg-i="${i}" title="${title}">${label}${blocked ? ' 🔒' : ''}</button>`;
  }).join('');
  $$('#om-templates .btn').forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.msgI, 10);
    const gate = tpls[i][2];
    const warn = gate ? gate() : null;
    if (warn && !window.confirm(warn)) return;
    openWhatsApp(o.phone, tpls[i][1]);
  }));

  // Populate complimentary dish picker
  const dishes = getTrialDishes();
  const sel = $('#om-comp-dish');
  if (sel) {
    sel.innerHTML = dishes.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    const enabled = !!o.comp_dish;
    $('#om-comp-enable').checked = enabled;
    $('#om-comp-pickers').hidden = !enabled;
    if (enabled && dishes.indexOf(o.comp_dish) >= 0) sel.value = o.comp_dish;
  }

  $('#om-custom').value = '';
  // Load any saved feedback for this order into the modal
  if (typeof loadFeedbackIntoModal === 'function') loadFeedbackIntoModal(o.order_number);
  openModal('#orderModal');
}

/* ---------- Trial / complimentary dishes (admin-managed list, localStorage) ---------- */
function getTrialDishes() {
  try {
    const raw = localStorage.getItem('sh_trial_dishes_v1');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) {}
  return ['Chicken Tikka', 'Mutton Pulao', 'Dal Makhani', 'Chicken Biryani', 'Seekh Kebab'];
}
function setTrialDishes(arr) {
  try { localStorage.setItem('sh_trial_dishes_v1', JSON.stringify(arr)); } catch (e) {}
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
function reminderTemplate(o, kind) {
  const date = cleanDate(o.date);
  const time = cleanTime(o.time);
  const when = date + (time ? ' at ' + time : '');
  const paid = (o.payment_status === 'Received');
  const del  = o.delivery_status || o.status || 'New';

  // Urgent: delivery within 24h, still unpaid
  if (kind === 'urgent' && !paid) {
    return `${greet(o)}\n\nA gentle reminder — your order *${o.order_number}* (${o.meat} ${o.quantity}kg, AED ${fmt(o.total)}) is scheduled for *${when}*, but we haven't received your payment yet.\n\nTo keep your slot, kindly transfer to:\n\n🏦 *RAK Bank*\nName: Mohamed Rihan Abdul Karim Rihan Abdul Karim Chougle\nIBAN: AE74 0400 0003 7201 1779 001\n\nPlease share the screenshot once done. If you'd like to reschedule, just let me know. 🙏${bizSig()}`;
  }
  // Unpaid (>12h) but no near delivery
  if (!paid) {
    return `${greet(o)}\n\nJust a friendly nudge on your order *${o.order_number}* (${o.meat} ${o.quantity}kg, AED ${fmt(o.total)}).\n\nWe haven't received the payment yet — once it's in, we'll lock in your slot for *${when}*.\n\n🏦 *RAK Bank* · IBAN: AE74 0400 0003 7201 1779 001\nName: Mohamed Rihan Abdul Karim Rihan Abdul Karim Chougle\n\nShare the screenshot when ready. Thank you 🙏${bizSig()}`;
  }
  // Paid but unconfirmed delivery state
  if (del === 'New' || del === 'Confirmed') {
    return `${greet(o)}\n\nQuick confirmation — your order *${o.order_number}* (${o.meat} ${o.quantity}kg) is on our list for *${when}*.\n\nWe'll message you the moment it's freshly cooked and ready. Thank you for your patience! 🙏${bizSig()}`;
  }
  // Fallback
  return `${greet(o)}\n\nA quick reminder about your order *${o.order_number}* scheduled for *${when}*. Please let us know if anything's changed.${bizSig()}`;
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
  return `${greet(o)}\n\nHope you enjoyed your bhuna gosht. 🙏\n\nA small reminder — 10% of every order goes back to those in need, so thank you for being part of that.\n\nIf you have a moment, we'd love to hear your honest feedback — just reply to this message. It helps us cook better and keeps our little kitchen going.${bizSig()}`;
}
function followUpTemplate(o) {
  return `${greet(o)}\n\nA quick hello from our kitchen — we hope you and your family are doing well.\n\nNo occasion, just wanted to thank you again for trusting us with your last meal. It meant a lot.\n\nWhenever you'd like us to cook for you again, we're here.\n\nWarmly,\nSpice Haus`;
}

/* Custom message */
function bindOrderModal() {
  $('#om-save-status').addEventListener('click', async () => {
    const o = state.currentOrder;
    if (!o) return;
    const payment_status  = $('#om-payment-status').value;
    const payment_ref     = ($('#om-payment-ref').value || '').trim();
    const delivery_status = $('#om-delivery-status').value;
    const btn = $('#om-save-status');
    btn.disabled = true; const oldLabel = btn.textContent; btn.textContent = 'Saving…';
    try {
      await apiPost({
        action: 'admin_update_status',
        order_number: o.order_number,
        payment_status,
        payment_ref,
        delivery_status
      });
      o.payment_status  = payment_status;
      o.payment_ref     = payment_ref;
      o.delivery_status = delivery_status;
      o.status          = delivery_status; // keep legacy field in sync
      toast('Order updated');
      renderOrders();
      // Refresh Today KPIs since pending count may change
      refreshToday();
    } catch (e) {
      toast('Update failed: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = oldLabel;
    }
  });

  $('#om-send-custom').addEventListener('click', () => {
    const o = state.currentOrder;
    const msg = ($('#om-custom').value || '').trim();
    if (!o || !msg) { toast('Type a message first'); return; }
    openWhatsApp(o.phone, msg);
  });

  $('#om-invoice-pdf').addEventListener('click', () => {
    const o = state.currentOrder;
    if (!o) return;
    try { generateInvoicePDF(o); }
    catch (e) { toast('PDF failed: ' + e.message); }
  });

  $('#om-invoice-print').addEventListener('click', () => {
    const o = state.currentOrder;
    if (!o) return;
    openInvoicePrint(o);
  });

  // Complimentary dish toggle + dropdown
  const compEnable = $('#om-comp-enable');
  const compPickers = $('#om-comp-pickers');
  const compSelect = $('#om-comp-dish');
  const compManage = $('#om-comp-manage');
  if (compEnable) {
    compEnable.addEventListener('change', () => {
      const on = compEnable.checked;
      compPickers.hidden = !on;
      if (state.currentOrder) {
        state.currentOrder.comp_dish = on ? (compSelect.value || getTrialDishes()[0] || '') : null;
      }
    });
  }
  if (compSelect) {
    compSelect.addEventListener('change', () => {
      if (state.currentOrder && compEnable.checked) {
        state.currentOrder.comp_dish = compSelect.value || null;
      }
    });
  }
  if (compManage) {
    compManage.addEventListener('click', () => {
      const current = getTrialDishes().join(', ');
      const next = window.prompt('Trial dishes (comma-separated):', current);
      if (next === null) return;
      const arr = next.split(',').map(s => s.trim()).filter(Boolean);
      if (!arr.length) { toast('Need at least one dish'); return; }
      setTrialDishes(arr);
      // Refresh dropdown, keeping prior selection if it still exists
      const prior = compSelect.value;
      compSelect.innerHTML = arr.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      // Prefer the newly-added dish (typically the last one); else keep prior if present; else first
      const wasInOld = current.split(',').map(s => s.trim()).filter(Boolean);
      const newlyAdded = arr.filter(d => wasInOld.indexOf(d) === -1);
      if (newlyAdded.length) {
        compSelect.value = newlyAdded[newlyAdded.length - 1];
      } else if (arr.indexOf(prior) >= 0) {
        compSelect.value = prior;
      } else {
        compSelect.value = arr[0];
      }
      // Sync state.currentOrder.comp_dish if checkbox is on
      if (state.currentOrder && compEnable && compEnable.checked) {
        state.currentOrder.comp_dish = compSelect.value || null;
      }
      toast('Saved — "' + compSelect.value + '" selected');
    });
  }
}

/* Configurable feedback link — paste your own Google Form URL here when ready.
   Until you do, only the WhatsApp feedback option is used. */
const FEEDBACK_FORM_URL = '';   // e.g. 'https://forms.gle/abcd1234'
const FEEDBACK_WHATSAPP = '971524718286';

/* ---------- INVOICE PDF ---------- */
function generateInvoicePDF(o) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('PDF library not loaded yet — refresh and try again');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const PAGE_W = 595.28, PAGE_H = 841.89;
  const MARGIN = 40;
  const TEAL  = [45, 95, 93];     // #2D5F5D
  const CREAM = [250, 246, 238];  // #FAF6EE
  const BRASS = [201, 154, 75];   // #C99A4B
  const INK   = [40, 50, 50];
  const MUTED = [110, 120, 120];

  // ===== HEADER =====
  doc.setFillColor(...TEAL);
  doc.rect(0, 0, PAGE_W, 120, 'F');

  // Logo tile with embedded burger
  doc.setFillColor(...CREAM);
  doc.roundedRect(MARGIN, 32, 64, 64, 10, 10, 'F');
  doc.setDrawColor(...BRASS);
  doc.setLineWidth(1.2);
  doc.roundedRect(MARGIN, 32, 64, 64, 10, 10, 'S');
  // Draw the actual logo image (teal burger on cream) inside the tile, fully centred.
  // The centred PNG already has symmetric padding baked in (374×254). Fit it into the tile.
  if (window.INVOICE_LOGO_PNG) {
    try {
      const tileX = MARGIN, tileY = 32, tileW = 64, tileH = 64;
      const lw = (window.INVOICE_LOGO_W || 374);
      const lh = (window.INVOICE_LOGO_H || 254);
      const aspect = lw / lh;
      // Fit inside the full tile (no extra inner padding — the image already has its own).
      let imgW = tileW;
      let imgH = imgW / aspect;
      if (imgH > tileH) { imgH = tileH; imgW = imgH * aspect; }
      const ix = tileX + (tileW - imgW) / 2;
      const iy = tileY + (tileH - imgH) / 2;
      doc.addImage(window.INVOICE_LOGO_PNG, 'PNG', ix, iy, imgW, imgH);
    } catch (e) {
      // fallback to SH text if image fails
      doc.setTextColor(...TEAL); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
      doc.text('SH', MARGIN + 32, 72, { align: 'center' });
    }
  }

  // Brand text (3 lines: name, location, phone)
  doc.setTextColor(...CREAM);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.text('Spice Haus', MARGIN + 80, 58);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Sharjah, UAE', MARGIN + 80, 78);
  doc.text('WhatsApp: +971 52 471 8286', MARGIN + 80, 94);

  // INVOICE label — top right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('INVOICE', PAGE_W - MARGIN, 58, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(o.order_number, PAGE_W - MARGIN, 78, { align: 'right' });
  const issued = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' });
  doc.text('Issued: ' + issued, PAGE_W - MARGIN, 94, { align: 'right' });

  // ===== BILL TO =====
  let y = 160;
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('BILL TO', MARGIN, y);
  doc.text('DELIVERY / PICKUP', PAGE_W / 2, y);

  y += 16;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  const customer = (o.first_name + ' ' + (o.last_name || '')).trim() || '—';
  doc.text(customer, MARGIN, y);
  doc.text(o.method || '—', PAGE_W / 2, y);

  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(o.phone || '—', MARGIN, y);
  doc.text((o.city || ''), PAGE_W / 2, y);

  let leftY = y, rightY = y;
  if (o.address) {
    rightY += 14;
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    const addrLines = doc.splitTextToSize(o.address, (PAGE_W / 2) - MARGIN - 10);
    doc.text(addrLines, PAGE_W / 2, rightY);
    rightY += (addrLines.length - 1) * 11;
  }

  // ===== DATES (Order date + Scheduled for) =====
  y = Math.max(leftY, rightY) + 24;
  const cleanedDate = cleanDate(o.date);
  const cleanedTime = cleanTime(o.time);
  const orderDateStr = o.timestamp
    ? new Date(o.timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : issued;
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('ORDER DATE', MARGIN, y);
  doc.text(`${(o.method || '').toLowerCase().indexOf('pickup') >= 0 ? 'PICKUP' : 'DELIVERY'} DATE & TIME`, PAGE_W / 2, y);
  y += 14;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(orderDateStr, MARGIN, y);
  doc.text(`${cleanedDate}${cleanedTime ? '  •  ' + cleanedTime : ''}`.trim() || '—', PAGE_W / 2, y);

  // ===== LINE ITEMS TABLE =====
  y += 32;
  // Header
  doc.setFillColor(...TEAL);
  doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, 26, 'F');
  doc.setTextColor(...CREAM);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('DESCRIPTION', MARGIN + 12, y + 17);
  doc.text('QTY', PAGE_W - MARGIN - 200, y + 17, { align: 'right' });
  doc.text('PRICE/KG', PAGE_W - MARGIN - 100, y + 17, { align: 'right' });
  doc.text('AMOUNT', PAGE_W - MARGIN - 12, y + 17, { align: 'right' });

  // Row — main meat line
  y += 26;
  doc.setFillColor(...CREAM);
  doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, 36, 'F');
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const meatDesc = `${o.meat || 'Bhuna'} Gosht`;
  doc.text(meatDesc, MARGIN + 12, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Slow-cooked traditional bhuna', MARGIN + 12, y + 28);

  doc.setTextColor(...INK);
  doc.setFontSize(11);
  doc.text(`${o.quantity || 0} kg`, PAGE_W - MARGIN - 200, y + 22, { align: 'right' });
  doc.text(`AED ${fmt(o.price_per_kg)}`, PAGE_W - MARGIN - 100, y + 22, { align: 'right' });
  const lineAmount = (Number(o.quantity || 0) * Number(o.price_per_kg || 0)) || (Number(o.total || 0) - Number(o.delivery_fee || 0));
  doc.text(`AED ${fmt(lineAmount)}`, PAGE_W - MARGIN - 12, y + 22, { align: 'right' });

  y += 36;

  // Complimentary dish row (if enabled on this order)
  if (o.comp_dish) {
    doc.setFillColor(255, 248, 236); // soft brass tint
    doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, 28, 'F');
    doc.setTextColor(...BRASS);
    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(10);
    doc.text(`Compliments of the kitchen: ${o.comp_dish}`, MARGIN + 12, y + 18);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('—', PAGE_W - MARGIN - 200, y + 18, { align: 'right' });
    doc.text('—', PAGE_W - MARGIN - 100, y + 18, { align: 'right' });
    doc.text('AED 0.00', PAGE_W - MARGIN - 12, y + 18, { align: 'right' });
    y += 28;
  }

  // Notes row (if any)
  if (o.notes) {
    doc.setFillColor(252, 250, 244);
    const noteLines = doc.splitTextToSize('Note: ' + o.notes, PAGE_W - 2 * MARGIN - 24);
    const noteH = 14 + noteLines.length * 12;
    doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, noteH, 'F');
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.text(noteLines, MARGIN + 12, y + 14);
    y += noteH;
  }

  // ===== TOTALS =====
  y += 16;
  const totalsX = PAGE_W - MARGIN - 220;
  doc.setTextColor(...MUTED);
  doc.setFontSize(10);
  doc.text('Subtotal', totalsX, y);
  doc.setTextColor(...INK);
  doc.text(`AED ${fmt(lineAmount)}`, PAGE_W - MARGIN, y, { align: 'right' });

  if (o.delivery_fee && Number(o.delivery_fee) > 0) {
    y += 16;
    doc.setTextColor(...MUTED);
    doc.text('Delivery fee', totalsX, y);
    doc.setTextColor(...INK);
    doc.text(`AED ${fmt(o.delivery_fee)}`, PAGE_W - MARGIN, y, { align: 'right' });
  }

  // Total bar
  y += 22;
  doc.setFillColor(...TEAL);
  doc.rect(totalsX - 12, y - 14, (PAGE_W - MARGIN) - (totalsX - 12), 28, 'F');
  doc.setTextColor(...CREAM);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('TOTAL', totalsX, y + 4);
  doc.text(`AED ${fmt(o.total)}`, PAGE_W - MARGIN, y + 4, { align: 'right' });

  // ===== PAYMENT INFO BLOCK =====
  const paid = (o.payment_status === 'Received');
  y += 44;
  const payBlockTop = y;
  doc.setDrawColor(...BRASS);
  doc.setFillColor(255, 248, 236);
  doc.roundedRect(MARGIN, y, PAGE_W - 2 * MARGIN, 110, 8, 8, 'FD');

  doc.setTextColor(...TEAL);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  if (paid) {
    doc.text('Payment received — thank you', MARGIN + 14, y + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    if (o.payment_ref) doc.text('Reference: ' + o.payment_ref, MARGIN + 14, y + 40);
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.text('We appreciate your business. Your bhuna is being prepared with care.', MARGIN + 14, y + 60);
  } else {
    doc.text('Payment instructions', MARGIN + 14, y + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text('Bank: The National Bank of Ras Al Khaimah (P.S.C.)', MARGIN + 14, y + 40);
    doc.text('Name: Mohamed Rihan Abdul Karim Rihan Abdul Karim Chougle', MARGIN + 14, y + 55);
    doc.text('Account: 0372011779001  •  IBAN: AE74 0400 0003 7201 1779 001', MARGIN + 14, y + 70);
    doc.text('SWIFT: NRAKAEAK', MARGIN + 14, y + 85);
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.text('Please share the payment screenshot via WhatsApp once done.', MARGIN + 14, y + 100);
  }

  // ===== CIRCULAR PAID STAMP (only if paid) =====
  // Placed on the right side of the payment block so the block + stamp share the same vertical space.
  if (paid) {
    const cx = PAGE_W - MARGIN - 50;
    const cy = payBlockTop + 55;
    doc.setDrawColor(120, 160, 90); // green
    doc.setTextColor(120, 160, 90);
    doc.setLineWidth(2);
    doc.circle(cx, cy, 34, 'S');
    doc.setLineWidth(0.7);
    doc.circle(cx, cy, 29, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('PAID', cx, cy + 2, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text('RECEIVED', cx, cy + 13, { align: 'center' });
  }
  y += 130;

  // ===== FEEDBACK BOX =====
  const fbY = y + 10;
  doc.setDrawColor(...BRASS);
  doc.setFillColor(255, 251, 244);
  doc.roundedRect(MARGIN, fbY, PAGE_W - 2 * MARGIN, 70, 8, 8, 'FD');
  doc.setTextColor(...TEAL);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text("How was your bhuna? We'd love your feedback.", MARGIN + 14, fbY + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  const waText = `WhatsApp us: +971 52 471 8286  •  wa.me/${FEEDBACK_WHATSAPP}?text=Feedback%20${encodeURIComponent(o.order_number || '')}`;
  doc.text(waText, MARGIN + 14, fbY + 38);
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  if (FEEDBACK_FORM_URL) {
    doc.text('Quick form: ' + FEEDBACK_FORM_URL, MARGIN + 14, fbY + 52);
  } else {
    doc.text('Or just reply to this number — we read every message.', MARGIN + 14, fbY + 52);
  }
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...BRASS);
  doc.text('• 10% of every order goes back to those in need. •', PAGE_W / 2, fbY + 64, { align: 'center' });

  // ===== FOOTER =====
  doc.setDrawColor(...BRASS);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, PAGE_H - 60, PAGE_W - MARGIN, PAGE_H - 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('Spice Haus  •  spicehaus.org  •  WhatsApp +971 52 471 8286  •  Sharjah, UAE', PAGE_W / 2, PAGE_H - 42, { align: 'center' });
  doc.text(`Invoice ${o.order_number}  •  Generated ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })}`, PAGE_W / 2, PAGE_H - 28, { align: 'center' });

  // Save
  const filename = `${o.order_number || 'invoice'}_${(o.first_name || 'customer').replace(/\s+/g,'_')}_invoice.pdf`;
  doc.save(filename);
  toast('Invoice downloaded — ' + filename);
}

/* Print preview — opens a styled HTML window the user can print or save as PDF natively */
function openInvoicePrint(o) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) { toast('Pop-up blocked — please allow pop-ups for spicehaus.org'); return; }
  const cleanedDate = cleanDate(o.date);
  const cleanedTime = cleanTime(o.time);
  const lineAmount = (Number(o.quantity || 0) * Number(o.price_per_kg || 0)) || (Number(o.total || 0) - Number(o.delivery_fee || 0));
  const paid = o.payment_status === 'Received';
  const issued = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' });
  const orderDate = o.timestamp ? new Date(o.timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : issued;
  const dateLabel = (o.method || '').toLowerCase().indexOf('pickup') >= 0 ? 'PICKUP DATE & TIME' : 'DELIVERY DATE & TIME';
  const logoImg = window.INVOICE_LOGO_PNG ? `<img src="${window.INVOICE_LOGO_PNG}" alt="Spice Haus" style="max-width:44px;max-height:38px;">` : 'SH';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(o.order_number)}</title>
<style>
body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #283232; margin: 0; padding: 40px; background: #fff; }
.inv { max-width: 720px; margin: 0 auto; }
.head { background: #2D5F5D; color: #FAF6EE; padding: 24px 28px; border-radius: 10px 10px 0 0; display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 14px; }
.tile { width: 52px; height: 52px; background: #FAF6EE; border: 1.5px solid #C99A4B; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #2D5F5D; font-weight: 800; font-size: 18px; }
.brand h1 { margin: 0; font-size: 22px; }
.brand small { font-size: 11px; opacity: 0.85; }
.right { text-align: right; }
.right h2 { margin: 0; font-size: 20px; letter-spacing: 1px; }
.right small { display: block; font-size: 11px; opacity: 0.85; margin-top: 2px; }
.paid-circle { width: 88px; height: 88px; border: 3px double #6FA050; border-radius: 50%; color: #6FA050; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; line-height: 1; margin: 12px 0 0 auto; transform: rotate(-6deg); }
.paid-circle small { font-size: 9px; font-weight: 500; margin-top: 4px; letter-spacing: 0.5px; }
.feedback-box { background: #FFFBF4; border: 1px solid #C99A4B; border-radius: 8px; padding: 14px 18px; margin-top: 22px; }
.feedback-box h3 { margin: 0 0 6px; font-size: 13px; color: #2D5F5D; }
.feedback-box .line { font-size: 11px; margin: 3px 0; color: #283232; }
.feedback-box .charity-mini { text-align: center; font-style: italic; font-size: 10px; color: #C99A4B; margin-top: 8px; }
.comp-row td { background: #FFF8EC !important; color: #C99A4B !important; font-style: italic; }
.body { border: 1px solid #eee; border-top: 0; padding: 24px 28px; border-radius: 0 0 10px 10px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
.label { font-size: 10px; font-weight: 700; color: #888; letter-spacing: 1px; margin-bottom: 6px; }
.name { font-size: 14px; font-weight: 700; }
.meta { font-size: 12px; color: #555; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; }
th { background: #2D5F5D; color: #FAF6EE; text-align: left; padding: 10px 12px; font-size: 11px; letter-spacing: 0.5px; }
th.r, td.r { text-align: right; }
td { background: #FAF6EE; padding: 14px 12px; font-size: 12px; border-top: 1px solid #fff; }
td .desc { font-weight: 700; font-size: 13px; }
td .sub { color: #888; font-size: 10px; margin-top: 3px; }
.totals { margin-left: auto; width: 280px; font-size: 12px; }
.totals .row { display: flex; justify-content: space-between; padding: 6px 0; color: #555; }
.totals .grand { background: #2D5F5D; color: #FAF6EE; font-weight: 700; padding: 10px 14px; border-radius: 6px; font-size: 14px; margin-top: 8px; display: flex; justify-content: space-between; }
.pay-box { background: #FFF8EC; border: 1px solid #C99A4B; padding: 16px 18px; border-radius: 8px; margin-top: 24px; }
.pay-box h3 { margin: 0 0 8px; font-size: 13px; color: #2D5F5D; }
.pay-box .line { font-size: 12px; color: #283232; margin: 4px 0; }
.pay-box .note { font-size: 10px; color: #888; margin-top: 10px; }
.charity { text-align: center; color: #C99A4B; font-style: italic; font-size: 11px; margin-top: 20px; }
.foot { text-align: center; font-size: 10px; color: #888; margin-top: 24px; padding-top: 12px; border-top: 1px solid #C99A4B; }
.actions { text-align: center; margin: 20px 0; }
.actions button { background: #2D5F5D; color: #FAF6EE; border: 0; padding: 10px 24px; border-radius: 999px; font-size: 14px; cursor: pointer; font-weight: 600; }
@media print { .actions { display: none; } body { padding: 0; } .inv { max-width: 100%; } }
</style></head><body>
<div class="actions"><button onclick="window.print()">🖨 Print or Save as PDF</button></div>
<div class="inv">
  <div class="head">
    <div class="brand">
      <div class="tile">${logoImg}</div>
      <div>
        <h1>Spice Haus</h1>
        <small>Sharjah, UAE</small><br>
        <small>WhatsApp: +971 52 471 8286</small>
      </div>
    </div>
    <div class="right">
      <h2>INVOICE</h2>
      <small>${escapeHtml(o.order_number)}</small>
      <small>Issued ${escapeHtml(issued)}</small>
    </div>
  </div>
  <div class="body">
    <div class="cols">
      <div>
        <div class="label">BILL TO</div>
        <div class="name">${escapeHtml((o.first_name + ' ' + (o.last_name || '')).trim() || '—')}</div>
        <div class="meta">${escapeHtml(o.phone || '—')}</div>
      </div>
      <div>
        <div class="label">DELIVERY / PICKUP</div>
        <div class="name">${escapeHtml(o.method || '—')}</div>
        <div class="meta">${escapeHtml(o.city || '')}${o.address ? '<br>' + escapeHtml(o.address) : ''}</div>
      </div>
    </div>
    <div class="cols">
      <div>
        <div class="label">ORDER DATE</div>
        <div class="meta" style="font-weight:600;color:#283232;">${escapeHtml(orderDate)}</div>
      </div>
      <div>
        <div class="label">${escapeHtml(dateLabel)}</div>
        <div class="meta" style="font-weight:600;color:#283232;">${escapeHtml(cleanedDate)}${cleanedTime ? '  •  ' + escapeHtml(cleanedTime) : ''}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>DESCRIPTION</th><th class="r">QTY</th><th class="r">PRICE/KG</th><th class="r">AMOUNT</th></tr></thead>
      <tbody><tr>
        <td><div class="desc">${escapeHtml(o.meat || 'Bhuna')} Gosht</div><div class="sub">Slow-cooked traditional bhuna</div></td>
        <td class="r">${escapeHtml(String(o.quantity || 0))} kg</td>
        <td class="r">AED ${fmt(o.price_per_kg)}</td>
        <td class="r">AED ${fmt(lineAmount)}</td>
      </tr>
      ${o.comp_dish ? `<tr class="comp-row"><td><div class="desc">Compliments of the kitchen: ${escapeHtml(o.comp_dish)}</div><div class="sub">A small thank-you from our kitchen — we'd love your feedback.</div></td><td class="r">—</td><td class="r">—</td><td class="r">AED 0.00</td></tr>` : ''}
      ${o.notes ? `<tr><td colspan="4" style="background:#fcfaf4;color:#888;font-size:11px;">Note: ${escapeHtml(o.notes)}</td></tr>` : ''}
      </tbody>
    </table>
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>AED ${fmt(lineAmount)}</span></div>
      ${o.delivery_fee && Number(o.delivery_fee) > 0 ? `<div class="row"><span>Delivery fee</span><span>AED ${fmt(o.delivery_fee)}</span></div>` : ''}
      <div class="grand"><span>TOTAL</span><span>AED ${fmt(o.total)}</span></div>
    </div>
    <div class="pay-box">
      ${paid
        ? `<h3>Payment received — thank you</h3>${o.payment_ref ? `<div class="line"><b>Reference:</b> ${escapeHtml(o.payment_ref)}</div>` : ''}<div class="note">We appreciate your business. Your bhuna is being prepared with care.</div>`
        : `<h3>Payment instructions</h3>
           <div class="line"><b>Bank:</b> The National Bank of Ras Al Khaimah (P.S.C.)</div>
           <div class="line"><b>Name:</b> Mohamed Rihan Abdul Karim Rihan Abdul Karim Chougle</div>
           <div class="line"><b>Account:</b> 0372011779001</div>
           <div class="line"><b>IBAN:</b> AE74 0400 0003 7201 1779 001</div>
           <div class="line"><b>SWIFT:</b> NRAKAEAK</div>
           <div class="note">Please share the payment screenshot via WhatsApp once done.</div>`}
    </div>
    ${paid ? `<div class="paid-circle">PAID<small>✓ received</small></div>` : ''}
    <div class="feedback-box">
      <h3>How was your bhuna? We'd love your feedback.</h3>
      <div class="line"><b>WhatsApp:</b> <a href="https://wa.me/${FEEDBACK_WHATSAPP}?text=${encodeURIComponent('Feedback for ' + (o.order_number || ''))}" target="_blank">+971 52 471 8286</a></div>
      ${FEEDBACK_FORM_URL ? `<div class="line"><b>Quick form:</b> <a href="${escapeHtml(FEEDBACK_FORM_URL)}" target="_blank">${escapeHtml(FEEDBACK_FORM_URL)}</a></div>` : `<div class="line" style="color:#888;font-size:10px;">Or just reply to this number — we read every message.</div>`}
      <div class="charity-mini">• 10% of every order goes back to those in need. •</div>
    </div>
    <div class="foot">Spice Haus  •  spicehaus.org  •  WhatsApp +971 52 471 8286  •  Sharjah, UAE</div>
  </div>
</div>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
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

/* ---------- CUSTOMERS ---------- */
/* Aggregates state.orders by phone. Returns array of customer objects:
   { phone, name, first_name, last_name, order_count, total_spend, last_order_date,
     last_order_ts, cities:Set<string>, methods:Set<string>, orders:[...]} */
function aggregateCustomers() {
  const map = new Map();
  (state.orders || []).forEach(o => {
    const phoneDigits = String(o.phone || '').replace(/\D/g, '');
    if (!phoneDigits) return;
    let c = map.get(phoneDigits);
    if (!c) {
      c = {
        phone: phoneDigits,
        phone_display: o.phone || phoneDigits,
        first_name: o.first_name || '',
        last_name: o.last_name || '',
        order_count: 0,
        total_spend: 0,
        last_order_ts: 0,
        last_order_date: '',
        cities: new Set(),
        methods: new Set(),
        orders: []
      };
      map.set(phoneDigits, c);
    }
    c.order_count += 1;
    const total = Number(o.total) || 0;
    c.total_spend += total;
    if (o.city) c.cities.add(o.city);
    if (o.method) c.methods.add(o.method);
    // Track the most recent order using its timestamp (preferred) or delivery date.
    const tsRaw = o.timestamp || o.date || '';
    const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
    if (ts && ts > c.last_order_ts) {
      c.last_order_ts = ts;
      c.last_order_date = tsRaw;
      // Keep the most recent name spelling (in case it was updated)
      if (o.first_name) c.first_name = o.first_name;
      if (o.last_name)  c.last_name  = o.last_name;
    }
    c.orders.push(o);
  });
  const out = [];
  map.forEach(c => {
    c.name = (c.first_name + ' ' + c.last_name).trim() || '(no name)';
    out.push(c);
  });
  return out;
}

function refreshCustomers() {
  $('#customersList').innerHTML = '<div class="empty">Loading…</div>';
  $('#customersSummary').textContent = 'Loading…';
  // If orders aren't loaded yet, fetch them first; otherwise just render.
  if (!state.orders || !state.orders.length) {
    refreshOrders().then(renderCustomers).catch(() => renderCustomers());
  } else {
    renderCustomers();
  }
}

function renderCustomers() {
  const all = aggregateCustomers();
  const q = (state.customerQuery || '').trim().toLowerCase();
  let list = all.filter(c => {
    if (!q) return true;
    const hay = (c.name + ' ' + c.phone + ' ' + c.phone_display).toLowerCase();
    return hay.indexOf(q) >= 0;
  });

  const sort = state.customerSort;
  list.sort((a, b) => {
    if (sort === 'recent') return b.last_order_ts - a.last_order_ts;
    if (sort === 'count')  return b.order_count - a.order_count || b.total_spend - a.total_spend;
    if (sort === 'name')   return a.name.localeCompare(b.name);
    return b.total_spend - a.total_spend; // 'spend' default
  });

  // Summary line
  const totalSpend = all.reduce((s, c) => s + c.total_spend, 0);
  const repeat = all.filter(c => c.order_count > 1).length;
  $('#customersSummary').textContent = `${all.length} customers · ${repeat} repeat · AED ${fmt(totalSpend)} lifetime`;

  if (!list.length) {
    $('#customersList').innerHTML = '<div class="empty">No customers match.</div>';
    return;
  }

  $('#customersList').innerHTML = list.map(c => {
    const repeatPill = c.order_count > 1 ? '<span class="pill pill-repeat">🔁 Repeat</span>' : '';
    const vipPill = c.total_spend >= 500 ? '<span class="pill pill-vip">⭐ VIP</span>' : '';
    // Short date only (no time) for the row to avoid wrap
    let last = '—';
    if (c.last_order_date) {
      const dt = new Date(c.last_order_date);
      last = isNaN(dt) ? cleanDate(c.last_order_date)
        : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    const cityLine = c.cities.size ? Array.from(c.cities).join(', ') : '';
    return `
      <div class="row cust-row" data-phone="${escapeHtml(c.phone)}">
        <div class="row-top">
          <div>
            <div class="row-name">${escapeHtml(c.name)}</div>
            <div class="row-meta">${escapeHtml(c.phone_display)}${cityLine ? ' · ' + escapeHtml(cityLine) : ''}</div>
          </div>
          <div class="pill-stack">
            ${vipPill}
            ${repeatPill}
          </div>
        </div>
        <div class="cust-stats-row">
          <div><span class="muted small">Orders</span><b>${c.order_count}</b></div>
          <div><span class="muted small">Lifetime</span><b>AED ${fmt(c.total_spend)}</b></div>
          <div><span class="muted small">Last order</span><b>${escapeHtml(last)}</b></div>
        </div>
        <div class="row-actions">
          <button type="button" class="qa-btn qa-ready" data-cust-wa="${escapeHtml(c.phone)}">💬 WhatsApp</button>
          <button type="button" class="qa-btn qa-ghost" data-cust-open="${escapeHtml(c.phone)}">View history</button>
        </div>
      </div>`;
  }).join('');

  // Wire clicks
  $$('#customersList .cust-row').forEach(r => {
    r.addEventListener('click', (e) => {
      const waBtn = e.target.closest('[data-cust-wa]');
      if (waBtn) {
        e.stopPropagation();
        const phone = waBtn.dataset.custWa;
        const c = aggregateCustomers().find(x => x.phone === phone);
        if (c) openWhatsApp(phone, greet(c) + '\n');
        return;
      }
      const phone = r.dataset.phone;
      openCustomerModal(phone);
    });
  });
}

function openCustomerModal(phone) {
  const c = aggregateCustomers().find(x => x.phone === phone);
  if (!c) { toast('Customer not found'); return; }
  state.currentCustomer = c;

  $('#cm-title').textContent = c.name;
  $('#cm-sub').textContent = c.phone_display;

  const cities = c.cities.size ? Array.from(c.cities).join(', ') : '—';
  $('#cm-stats').innerHTML = `
    <div class="cust-stat"><span class="muted small">Orders</span><b>${c.order_count}</b></div>
    <div class="cust-stat"><span class="muted small">Lifetime spend</span><b>AED ${fmt(c.total_spend)}</b></div>
    <div class="cust-stat"><span class="muted small">Avg order</span><b>AED ${fmt(c.order_count ? c.total_spend / c.order_count : 0)}</b></div>
    <div class="cust-stat"><span class="muted small">Last order</span><b>${escapeHtml(c.last_order_date ? cleanDate(c.last_order_date) : '—')}</b></div>
    <div class="cust-stat span-2"><span class="muted small">Areas</span><b>${escapeHtml(cities)}</b></div>
  `;

  // Sort orders newest first by timestamp
  const orders = c.orders.slice().sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  $('#cm-history').innerHTML = orders.map(o => {
    const pay = o.payment_status || 'Pending';
    const del = o.delivery_status || o.status || 'New';
    return `
      <div class="cust-history-row" data-order="${escapeHtml(o.order_number)}">
        <div class="chr-top">
          <span class="chr-num">${escapeHtml(o.order_number)}</span>
          <span class="chr-amt">AED ${fmt(o.total)}</span>
        </div>
        <div class="chr-meta">${escapeHtml(o.meat || '')} ${o.quantity || ''}${o.quantity ? 'kg' : ''} · ${escapeHtml(o.method || '')}${o.city ? ' · ' + escapeHtml(o.city) : ''}</div>
        <div class="chr-foot">
          <span class="row-meta">${escapeHtml(cleanDate(o.date))}${o.time ? ' · ' + escapeHtml(cleanTime(o.time)) : ''}</span>
          <span class="pill pay-${cssClass(pay)}">${escapeHtml(pay)}</span>
          <span class="pill ${cssClass(del)}">${escapeHtml(del)}</span>
        </div>
      </div>`;
  }).join('') || '<div class="empty">No orders.</div>';

  // Clicking a history row opens that order
  $$('#cm-history .cust-history-row').forEach(row => {
    row.addEventListener('click', () => {
      const num = row.dataset.order;
      const o = state.orders.find(x => x.order_number === num);
      if (o) {
        closeModal('#customerModal');
        openOrder(o.order_number);
      }
    });
  });

  openModal('#customerModal');
}

function bindCustomersTab() {
  const search = $('#customerSearch');
  if (search) search.addEventListener('input', () => {
    state.customerQuery = search.value || '';
    renderCustomers();
  });
  const sortSel = $('#customerSort');
  if (sortSel) sortSel.addEventListener('change', () => {
    state.customerSort = sortSel.value;
    renderCustomers();
  });
  const waBtn = $('#cm-wa');
  if (waBtn) waBtn.addEventListener('click', () => {
    const c = state.currentCustomer; if (!c) return;
    openWhatsApp(c.phone, greet(c) + '\n');
  });
  const waThx = $('#cm-wa-thanks');
  if (waThx) waThx.addEventListener('click', () => {
    const c = state.currentCustomer; if (!c) return;
    const msg = `${greet(c)}\n\nThank you for being a valued Spice Haus customer. We appreciate your continued support and look forward to serving you again soon.${bizSig()}`;
    openWhatsApp(c.phone, msg);
  });
}

/* ---------- FEEDBACK (localStorage) ----------
   Stored as a map { [order_number]: { rating: 1-5, note: string, ts: epoch_ms } } */
const FEEDBACK_KEY = 'sh_feedback_v1';
function getAllFeedback() {
  try { const raw = localStorage.getItem(FEEDBACK_KEY);
    if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') return o; } }
  catch (e) {}
  return {};
}
function setFeedback(orderNum, data) {
  const all = getAllFeedback();
  if (!data) delete all[orderNum]; else all[orderNum] = data;
  try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(all)); } catch (e) {}
}
function getFeedback(orderNum) {
  const all = getAllFeedback();
  return all[orderNum] || null;
}

function paintStars(scope, rating) {
  $$('#' + scope + ' .fb-star').forEach(b => {
    const r = parseInt(b.dataset.r, 10);
    b.textContent = r <= rating ? '★' : '☆';
    b.classList.toggle('on', r <= rating);
  });
}

function bindFeedbackInModal() {
  const stars = $$('#om-fb-stars .fb-star');
  stars.forEach(b => b.addEventListener('click', () => {
    const r = parseInt(b.dataset.r, 10);
    paintStars('om-fb-stars', r);
    const o = state.currentOrder; if (!o) return;
    o._fb_rating = r;
  }));
  const clr = $('#om-fb-clear');
  if (clr) clr.addEventListener('click', () => {
    paintStars('om-fb-stars', 0);
    $('#om-fb-note').value = '';
    const o = state.currentOrder; if (!o) return;
    o._fb_rating = 0;
    setFeedback(o.order_number, null);
    toast('Feedback cleared');
  });
  const save = $('#om-fb-save');
  if (save) save.addEventListener('click', () => {
    const o = state.currentOrder; if (!o) return;
    const rating = o._fb_rating || 0;
    const note = ($('#om-fb-note').value || '').trim();
    if (!rating && !note) { toast('Add a rating or a note first'); return; }
    setFeedback(o.order_number, { rating, note, ts: Date.now() });
    toast('Feedback saved');
  });
}

/* Populate feedback fields when an order modal opens.
   Called from openOrder() via a hook in renderOrders flow. */
function loadFeedbackIntoModal(orderNum) {
  const fb = getFeedback(orderNum);
  const r = fb ? (fb.rating || 0) : 0;
  paintStars('om-fb-stars', r);
  $('#om-fb-note').value = fb ? (fb.note || '') : '';
  if (state.currentOrder) state.currentOrder._fb_rating = r;
}

/* ---------- REPORTS ---------- */
function startOfDayDubai(d) {
  // Treat all dates as Dubai-local (UTC+4). We just zero h/m/s.
  const x = new Date(d); x.setHours(0,0,0,0); return x;
}
function reportRangeBounds() {
  const now = new Date();
  const today = startOfDayDubai(now);
  const dow = today.getDay(); // 0=Sun
  // Treat Monday as week start.
  const daysSinceMon = (dow === 0) ? 6 : (dow - 1);
  const thisMon = new Date(today); thisMon.setDate(today.getDate() - daysSinceMon);
  const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
  const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1); lastSun.setHours(23,59,59,999);
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0); lastMonthEnd.setHours(23,59,59,999);
  const ytdStart = new Date(today.getFullYear(), 0, 1);
  const endOfToday = new Date(today); endOfToday.setHours(23,59,59,999);

  switch (state.reportRange) {
    case 'last_week':   return { from: lastMon, to: lastSun, label: 'Last week' };
    case 'this_month':  return { from: thisMonthStart, to: endOfToday, label: 'This month' };
    case 'last_month':  return { from: lastMonthStart, to: lastMonthEnd, label: 'Last month' };
    case 'ytd':         return { from: ytdStart, to: endOfToday, label: 'Year to date' };
    case 'custom': {
      const f = state.reportCustom.from ? new Date(state.reportCustom.from) : thisMon;
      const t = state.reportCustom.to   ? new Date(state.reportCustom.to)   : endOfToday;
      t.setHours(23,59,59,999);
      return { from: f, to: t, label: 'Custom range' };
    }
    case 'this_week':
    default:            return { from: thisMon, to: endOfToday, label: 'This week' };
  }
}
function fmtDateShort(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function orderInRange(o, from, to) {
  // Use timestamp B if present, else delivery date M.
  const raw = o.timestamp || o.date || '';
  if (!raw) return false;
  const dt = new Date(raw);
  if (isNaN(dt)) return false;
  return dt >= from && dt <= to;
}

function refreshReports() {
  // Ensure orders + expenses loaded
  const ordersP = (state.orders && state.orders.length) ? Promise.resolve() : refreshOrders();
  const expP    = (state.expenses && state.expenses.length) ? Promise.resolve() : refreshExpenses();
  Promise.all([ordersP, expP]).finally(renderReports).catch(() => renderReports());
}

function renderReports() {
  const { from, to, label } = reportRangeBounds();
  $('#repRangeLabel').textContent = `${label} · ${fmtDateShort(from)} → ${fmtDateShort(to)}`;

  const ordersAll = (state.orders || []).filter(o => orderInRange(o, from, to));
  // Only count revenue from non-cancelled orders
  const orders = ordersAll.filter(o => (o.delivery_status || o.status || '').toLowerCase() !== 'cancelled');
  const revenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const avg = orders.length ? revenue / orders.length : 0;

  const expensesAll = (state.expenses || []).filter(x => {
    const raw = x.date || x.timestamp || '';
    if (!raw) return false;
    const dt = new Date(raw); if (isNaN(dt)) return false;
    return dt >= from && dt <= to;
  });
  const expenses = expensesAll.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const charity = revenue * 0.10;
  const net = revenue - expenses - charity;

  $('#repOrders').textContent   = orders.length;
  $('#repRevenue').textContent  = fmt(revenue);
  $('#repAvg').textContent      = fmt(avg);
  $('#repExpenses').textContent = fmt(expenses);
  $('#repNet').textContent      = fmt(net);
  $('#repCharity').textContent  = fmt(charity);

  // Meat split (kg + AED)
  const meat = {};
  orders.forEach(o => {
    const m = o.meat || 'Unknown';
    if (!meat[m]) meat[m] = { kg: 0, aed: 0, count: 0 };
    meat[m].kg    += Number(o.quantity) || 0;
    meat[m].aed   += Number(o.total) || 0;
    meat[m].count += 1;
  });
  const meatTotalAed = Object.values(meat).reduce((s, v) => s + v.aed, 0) || 1;
  $('#repMeatSplit').innerHTML = Object.keys(meat).sort().map(m => {
    const v = meat[m];
    const pct = Math.round((v.aed / meatTotalAed) * 100);
    return `
      <div class="split-row">
        <div class="split-top"><b>${escapeHtml(m)}</b><span>${v.count} orders · ${fmt(v.kg)}kg · AED ${fmt(v.aed)}</span></div>
        <div class="split-bar"><div class="split-bar-fill" style="width:${pct}%"></div></div>
        <div class="split-pct">${pct}%</div>
      </div>`;
  }).join('') || '<div class="empty">No orders in this range.</div>';

  // Emirate split (Sharjah / Ajman / Dubai)
  const emirates = { Sharjah: 0, Ajman: 0, Dubai: 0, Other: 0 };
  const eCounts  = { Sharjah: 0, Ajman: 0, Dubai: 0, Other: 0 };
  orders.forEach(o => {
    const city = (o.city || '').trim();
    const key = ['Sharjah','Ajman','Dubai'].indexOf(city) >= 0 ? city : 'Other';
    emirates[key] += Number(o.total) || 0;
    eCounts[key] += 1;
  });
  const eTotal = Object.values(emirates).reduce((s, v) => s + v, 0) || 1;
  $('#repEmirateSplit').innerHTML = Object.keys(emirates).map(k => {
    const aed = emirates[k]; const cnt = eCounts[k];
    if (!cnt) return '';
    const pct = Math.round((aed / eTotal) * 100);
    return `
      <div class="split-row">
        <div class="split-top"><b>${escapeHtml(k)}</b><span>${cnt} orders · AED ${fmt(aed)}</span></div>
        <div class="split-bar"><div class="split-bar-fill" style="width:${pct}%"></div></div>
        <div class="split-pct">${pct}%</div>
      </div>`;
  }).join('') || '<div class="empty">No deliveries in this range.</div>';

  // Top 10 customers (by spend in this range only)
  const byPhone = new Map();
  orders.forEach(o => {
    const ph = String(o.phone || '').replace(/\D/g, ''); if (!ph) return;
    const name = ((o.first_name||'') + ' ' + (o.last_name||'')).trim() || '(no name)';
    let c = byPhone.get(ph);
    if (!c) { c = { phone: ph, phone_display: o.phone || ph, name, count: 0, total: 0 }; byPhone.set(ph, c); }
    c.count += 1; c.total += Number(o.total) || 0;
  });
  const top = Array.from(byPhone.values()).sort((a,b) => b.total - a.total).slice(0, 10);
  $('#repTop').innerHTML = top.length ? top.map((c, i) => `
    <div class="top-row">
      <span class="top-rank">#${i+1}</span>
      <div class="top-name">${escapeHtml(c.name)}<div class="row-meta">${escapeHtml(c.phone_display)} · ${c.count} order${c.count>1?'s':''}</div></div>
      <span class="top-amt">AED ${fmt(c.total)}</span>
    </div>`).join('') : '<div class="empty">No customers in this range.</div>';

  // Reviews & feedback for orders in range
  const fbAll = getAllFeedback();
  const reviews = orders
    .map(o => ({ o, fb: fbAll[o.order_number] }))
    .filter(x => x.fb && (x.fb.rating || x.fb.note))
    .sort((a, b) => (b.fb.ts || 0) - (a.fb.ts || 0));

  if (!reviews.length) {
    $('#repReviews').innerHTML = '<div class="empty">No feedback recorded yet. Open an order → Customer feedback to log one.</div>';
  } else {
    const totalR = reviews.filter(r => r.fb.rating).reduce((s, r) => s + r.fb.rating, 0);
    const countR = reviews.filter(r => r.fb.rating).length;
    const avgR = countR ? (totalR / countR) : 0;
    const avgLine = countR ? `<div class="rev-summary"><b>${avgR.toFixed(1)} ★</b> avg · ${countR} rating${countR>1?'s':''}</div>` : '';
    $('#repReviews').innerHTML = avgLine + reviews.map(r => {
      const stars = r.fb.rating ? ('★'.repeat(r.fb.rating) + '☆'.repeat(5 - r.fb.rating)) : '';
      const name = ((r.o.first_name||'') + ' ' + (r.o.last_name||'')).trim() || '(no name)';
      return `
        <div class="rev-row" data-order="${escapeHtml(r.o.order_number)}">
          <div class="rev-top">
            <span class="rev-stars">${stars}</span>
            <span class="rev-name">${escapeHtml(name)}</span>
            <span class="rev-num">${escapeHtml(r.o.order_number)}</span>
          </div>
          ${r.fb.note ? `<div class="rev-note">${escapeHtml(r.fb.note)}</div>` : ''}
        </div>`;
    }).join('');
    $$('#repReviews .rev-row').forEach(row => row.addEventListener('click', () => {
      const num = row.dataset.order;
      if (num) openOrder(num);
    }));
  }

  // Save range for CSV use
  state._lastReport = { from, to, orders };
}

function downloadOrdersCsv() {
  if (!state._lastReport) refreshReports();
  const { from, to, orders } = state._lastReport || {};
  if (!orders || !orders.length) { toast('No orders in this range'); return; }
  const cols = ['order_number','timestamp','first_name','last_name','phone','meat','price_per_kg','quantity','method','city','address','time','date','notes','total','delivery_fee','payment_ref','payment_status','delivery_status'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const head = cols.join(',');
  const rows = orders.map(o => cols.map(k => esc(o[k] !== undefined ? o[k] : '')).join(','));
  const csv = head + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fname = `spice-haus-orders_${from.toISOString().slice(0,10)}_to_${to.toISOString().slice(0,10)}.csv`;
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindReportsTab() {
  // Range chips
  const range = $('#repRange');
  if (range) range.addEventListener('click', (e) => {
    const btn = e.target.closest('.rep-chip'); if (!btn) return;
    state.reportRange = btn.dataset.range;
    $$('#repRange .rep-chip').forEach(b => b.classList.toggle('active', b === btn));
    $('#repCustom').hidden = (state.reportRange !== 'custom');
    if (state.reportRange !== 'custom') renderReports();
  });
  const apply = $('#repApply');
  if (apply) apply.addEventListener('click', () => {
    state.reportCustom.from = $('#repFrom').value || null;
    state.reportCustom.to   = $('#repTo').value   || null;
    renderReports();
  });
  const csv = $('#repCsv');
  if (csv) csv.addEventListener('click', downloadOrdersCsv);
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
    if (['today','orders','customers','reports','expenses'].indexOf(name) >= 0) showTab(name);
  });

  // Order filters
  $('#orderSearch').addEventListener('input', renderOrders);
  $('#orderStatusFilter').addEventListener('change', renderOrders);

  // Quick-filter chips
  const qf = $('#quickFilters');
  if (qf) {
    qf.addEventListener('click', (e) => {
      const btn = e.target.closest('.qf-btn');
      if (!btn) return;
      state.quickFilter = btn.dataset.qf;
      $$('#quickFilters .qf-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderOrders();
    });
  }

  // Reminders banner → jump to the Reminders filter
  const rbBtn = document.getElementById('rb-filter');
  if (rbBtn) {
    rbBtn.addEventListener('click', () => {
      state.quickFilter = 'stale';
      $$('#quickFilters .qf-btn').forEach(b => b.classList.toggle('active', b.dataset.qf === 'stale'));
      renderOrders();
    });
  }

  bindModalClose();
  bindExpenseForm();
  bindOrderModal();
  bindCustomersTab();
  bindReportsTab();
  bindFeedbackInModal();

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
