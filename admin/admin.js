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
