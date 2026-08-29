/* =====================================================================
   MTX GROUP — UI helpers: formatting, toasts, modals, charts, i18n
   ===================================================================== */
const UI = (() => {
  /* ---------------- Currency ----------------
     Supported currencies. `decimals: 0` for IQD because the dinar is not
     traded in fractions — fils are long out of circulation. `step` drives
     number inputs, `notes` drives the POS quick-cash buttons. */
  const CURRENCIES = {
    USD: {
      code: 'USD', name: 'US Dollar', symbol: '$', position: 'before',
      decimals: 2, step: 0.01, notes: [1, 5, 10, 20, 50, 100]
    },
    IQD: {
      code: 'IQD', name: 'Iraqi Dinar', symbol: 'د.ع', position: 'after',
      decimals: 0, step: 250, notes: [250, 500, 1000, 5000, 10000, 25000, 50000]
    }
  };
  // Older installs stored the raw symbol ('$') rather than a code — map them.
  const LEGACY = { $: 'USD', USD: 'USD', IQD: 'IQD', 'د.ع': 'IQD' };
  const normalizeCode = (c) => LEGACY[c] || (CURRENCIES[c] ? c : 'USD');

  let CUR = CURRENCIES.USD;
  let FX = 1320; // IQD per 1 USD (Central Bank of Iraq official rate); editable in Settings

  const setCurrency = (c) => { CUR = CURRENCIES[normalizeCode(c)]; };
  const currency = () => CUR;
  const currencies = () => CURRENCIES;
  const setRate = (r) => { FX = Number(r) > 0 ? Number(r) : 1320; };
  const rate = () => FX;

  /* Round to the target currency's precision (whole dinars / cents). */
  const roundTo = (v, code) => {
    const d = CURRENCIES[normalizeCode(code || CUR.code)].decimals;
    const f = Math.pow(10, d);
    return Math.round((Number(v) || 0) * f) / f;
  };
  /* Factor to convert an amount from one currency to the other. */
  const fxFactor = (from, to) => {
    from = normalizeCode(from); to = normalizeCode(to);
    if (from === to) return 1;
    return from === 'USD' ? FX : 1 / FX;
  };

  const money = (n) => {
    const v = Number(n || 0);
    const s = v.toLocaleString(undefined, { minimumFractionDigits: CUR.decimals, maximumFractionDigits: CUR.decimals });
    return CUR.position === 'before' ? `${CUR.symbol}${s}` : `${s} ${CUR.symbol}`;
  };
  const num = (n) => Number(n || 0).toLocaleString();

  const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ---------------- Dates ----------------
     Everything here is LOCAL-time based. Using toISOString() would bucket by UTC,
     which files a 01:00 sale in Baghdad (UTC+3) under the previous day. */
  const isDayKey = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const parseDayKey = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const asDate = (t) => (isDayKey(t) ? parseDayKey(t) : new Date(t));

  const loc = () => (window.App && App.lang === 'ar') ? 'ar' : undefined; // localize date names with the UI language
  const fmtDate = (t) => asDate(t).toLocaleDateString(loc(), { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtDT = (t) => asDate(t).toLocaleString(loc(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dayKey = (t) => {
    const d = asDate(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const monthKey = (t) => dayKey(t).slice(0, 7);
  const isToday = (t) => dayKey(t) === dayKey(Date.now());
  const startOfDay = (t) => { const d = asDate(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const endOfDay = (t) => { const d = asDate(t); d.setHours(23, 59, 59, 999); return d.getTime(); };

  /* ---------------- Shared date-range filter ----------------
     Used by Reports, Expenses and Invoices so they all behave identically.
     Ranges are inclusive of both end days, in local time. */
  const PRESETS = [
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'],
    ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All time']
  ];
  const rangeOf = (key) => {
    const now = new Date();
    const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
    switch (key) {
      case 'today': return { from: startOfDay(now.getTime()), to: endOfDay(now.getTime()) };
      case 'yesterday': return { from: startOfDay(shift(-1).getTime()), to: endOfDay(shift(-1).getTime()) };
      case '7d': return { from: startOfDay(shift(-6).getTime()), to: endOfDay(now.getTime()) };
      case '30d': return { from: startOfDay(shift(-29).getTime()), to: endOfDay(now.getTime()) };
      case 'month': return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1).getTime()), to: endOfDay(now.getTime()) };
      case 'lastmonth': return {
        from: startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()),
        to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0).getTime()) // day 0 = last day of prev month
      };
      case 'year': return { from: startOfDay(new Date(now.getFullYear(), 0, 1).getTime()), to: endOfDay(now.getTime()) };
      case 'all': default: return { from: null, to: null };
    }
  };
  const inRange = (st, ts) => (st.from == null || ts >= st.from) && (st.to == null || ts <= st.to);
  const rangeLabel = (st) => {
    const p = PRESETS.find(([k]) => k === st.preset);
    const span = st.from == null ? 'All dates' : `${fmtDate(st.from)} → ${fmtDate(st.to)}`;
    return { name: p ? p[1] : 'Custom range', span };
  };
  const dateFilterHTML = (active = '30d') => `
    <div class="card no-print" style="padding:14px 16px;margin-bottom:16px">
      <div class="row wrap between" style="gap:12px">
        <div class="row wrap" style="gap:6px" id="df_chips">
          ${PRESETS.map(([k, l]) => `<div class="chip sm ${k === active ? 'active' : ''}" data-r="${k}">${l}</div>`).join('')}
        </div>
        <div class="row" style="gap:8px">
          <input type="date" class="input" id="df_from" style="width:auto;padding:8px 10px">
          <span class="muted">→</span>
          <input type="date" class="input" id="df_to" style="width:auto;padding:8px 10px">
          <button class="btn primary sm" id="df_apply">Apply</button>
        </div>
      </div>
      <div class="tiny muted" id="df_summary" style="margin-top:10px"></div>
    </div>`;
  function bindDateFilter(root, state, onChange) {
    const chips = root.querySelector('#df_chips');
    const fromIn = root.querySelector('#df_from'), toIn = root.querySelector('#df_to');
    const sync = () => {
      fromIn.value = state.from == null ? '' : dayKey(state.from);
      toIn.value = state.to == null ? '' : dayKey(state.to);
    };
    chips.addEventListener('click', (e) => {
      const c = e.target.closest('[data-r]'); if (!c) return;
      state.preset = c.dataset.r; Object.assign(state, rangeOf(c.dataset.r));
      chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.dataset.r === state.preset));
      sync(); onChange();
    });
    root.querySelector('#df_apply').onclick = () => {
      if (!fromIn.value && !toIn.value) return toast('Pick a start and end date', 'warn');
      let f = fromIn.value ? startOfDay(fromIn.value) : null;
      let t = toIn.value ? endOfDay(toIn.value) : null;
      if (f != null && t != null && f > t) { [f, t] = [startOfDay(toIn.value), endOfDay(fromIn.value)]; toast('Dates were swapped into order', 'info'); }
      state.from = f; state.to = t; state.preset = 'custom';
      chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      sync(); onChange();
    };
    sync();
  }

  // ---- Toast ----
  function toast(msg, type = 'ok') {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const icons = { ok: '✓', err: '✕', warn: '⚠', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `toast ${type === 'ok' ? '' : type}`;
    el.innerHTML = `<span>${icons[type] || '✓'}</span><span>${esc(msg)}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; setTimeout(() => el.remove(), 300); }, 2600);
  }

  // ---- Modal ----
  function modal({ title, body, footer, wide }) {
    close();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}">
        <div class="modal-head"><h3>${title || ''}</h3><button class="icon-btn" data-close>✕</button></div>
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    return ov;
  }
  function close() { document.querySelectorAll('.overlay').forEach((o) => o.remove()); }

  function confirm(msg, onYes, { danger } = {}) {
    modal({
      title: 'Please confirm',
      body: `<p style="font-size:14.5px;color:var(--text-2)">${esc(msg)}</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn ${danger ? 'danger' : 'primary'}" id="cfy">Confirm</button>`
    });
    document.getElementById('cfy').onclick = () => { close(); onYes && onYes(); };
  }

  // ---- Simple SVG charts ----
  /* The chart scales to its container via viewBox, which means everything
     inside it — labels, stroke widths, dots — scales down too. On a phone a
     640-unit viewBox squeezed into ~300px renders 10pt labels at about 5px:
     unreadable, and this is exactly the screen the owner checks his takings
     on. So narrow screens get their own taller, coarser geometry rather than
     a shrunken copy of the desktop one. */
  function lineChart(data, opts = {}) {
    if (!data.length) return '<div class="muted center" style="height:180px;display:grid">No data</div>';
    const narrow = window.innerWidth <= 560;
    const {
      w = narrow ? 360 : 640,
      h = narrow ? 230 : 200,
      color = 'var(--primary)',
      pad = narrow ? 28 : 24,
      labelSize = narrow ? 13 : 10,
      stroke = narrow ? 3 : 2.5,
      dot = narrow ? 4.5 : 3.5
    } = opts;

    const max = Math.max(...data.map((d) => d.v), 1);
    const iw = w - pad * 2, ih = h - pad * 2;
    const step = data.length > 1 ? iw / (data.length - 1) : 0;
    const pts = data.map((d, i) => [pad + i * step, pad + ih - (d.v / max) * ih]);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${path} L${(pad + (data.length - 1) * step).toFixed(1)} ${pad + ih} L${pad} ${pad + ih} Z`;
    const gl = [0, .25, .5, .75, 1].map((f) => `<line x1="${pad}" y1="${pad + ih * f}" x2="${w - pad}" y2="${pad + ih * f}" stroke="var(--border)" stroke-width="1"/>`).join('');
    const labs = data.map((d, i) => `<text x="${pad + i * step}" y="${h - 6}" font-size="${labelSize}" fill="var(--text-3)" text-anchor="middle">${esc(d.l)}</text>`).join('');
    const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${dot}" fill="${color}"/>`).join('');
    // Unique gradient id so two charts on one page don't share a fill.
    const gid = 'lc' + Math.random().toString(36).slice(2, 8);
    return `<svg viewBox="0 0 ${w} ${h}" class="chart" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${gl}<path d="${area}" fill="url(#${gid})"/><path d="${path}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/>${dots}${labs}
    </svg>`;
  }

  function donut(parts, { size = 160 } = {}) {
    const total = parts.reduce((s, p) => s + p.v, 0) || 1;
    let acc = 0; const r = 60, c = 2 * Math.PI * r, cx = size / 2, cy = size / 2;
    const segs = parts.map((p) => {
      const frac = p.v / total; const dash = frac * c;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.c}" stroke-width="22"
        stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"/>`;
      acc += dash; return el;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${segs}
      <circle cx="${cx}" cy="${cy}" r="46" fill="var(--surface)"/>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="12" fill="var(--text-3)">Total</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--text)">${num(total)}</text></svg>`;
  }

  function bars(rows, fmt = money) {
    const max = Math.max(...rows.map((r) => r.v), 1);
    return rows.map((r) => `<div class="bar-row"><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.l)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.v / max * 100).toFixed(1)}%"></div></div>
      <b class="mono" style="text-align:right;font-size:12px">${fmt(r.v)}</b></div>`).join('');
  }

  return {
    money, num, uid, esc, fmtDate, fmtDT, dayKey, monthKey, isToday, startOfDay, endOfDay, parseDayKey,
    toast, modal, close, confirm, lineChart, donut, bars,
    setCurrency, currency, currencies, setRate, rate, roundTo, fxFactor,
    PRESETS, rangeOf, inRange, rangeLabel, dateFilterHTML, bindDateFilter
  };
})();
window.UI = UI;
