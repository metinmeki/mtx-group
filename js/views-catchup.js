/* =====================================================================
   MTX GROUP — Catch-up sales from a stock count

   One-time migration tool. A shop traded on an offline copy; the online
   system never saw those sales. Given the product export taken BEFORE that
   trading (opening) and one taken AFTER (closing), this works out what left
   the shelf and records it as a single catch-up invoice, so revenue, cost,
   profit and the dashboard reflect the trading that happened.

   Intended flow:
     1. Products -> Import from Excel  ... the OPENING file (stock as it was)
     2. this tool                      ... opening + closing files
     3. stock now equals the closing file, and the money is on the books

   WHAT THIS CANNOT KNOW — read before trusting the totals:

   Stock falls for reasons other than a sale and rises for reasons other
   than a refund. `opening - closing` is NET MOVEMENT, not sales. If a
   product was restocked mid-period the difference understates what sold:
   start 40, sell 30, restock 20, end 30 -> the difference says 10.

   So every row is classified, and anything that cannot be read as a plain
   sale is flagged and set to 0 for a human to fill in. The figures are also
   missing the real sale dates, the real prices at the time, discounts given,
   payment methods, the cashier, refunds and exchanges. It reconstructs the
   MONEY, not the history.

   Where the shop's original data still exists, importing its backup is
   exact and this tool is the wrong choice (see server/README.md).
   ===================================================================== */

/* Match a spreadsheet row to a product: barcode, then SKU, then name. */
function cuKey(r) {
  return (r.barcode && 'b:' + r.barcode)
    || (r.sku && 's:' + String(r.sku).toLowerCase())
    || ('n:' + String(r.name || '').trim().toLowerCase());
}

/* Read one uploaded file into { key -> {name, stock, price, cost, ...} }. */
async function cuReadFile(file) {
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls isn’t supported — Save As .xlsx or CSV');
  const rows = /\.xlsx$/i.test(file.name)
    ? await XLSXLite.readXlsx(await file.arrayBuffer())
    : parseCSV(await file.text());
  if (rows.length < 2) throw new Error('that file has no data rows');

  const map = mapHeaders(rows[0]);
  if (map.name === undefined) throw new Error('no "Name" column found');
  if (map.stock === undefined) throw new Error('no "Stock" column found — the difference can’t be worked out without it');

  const out = new Map();
  rows.slice(1).forEach((r) => {
    const get = (k) => (map[k] === undefined ? '' : String(r[map[k]] ?? '').trim());
    const name = get('name');
    if (!name) return;
    const rec = {
      name,
      stock: Math.round(toNum(get('stock'))),
      price: get('price') === '' ? null : toNum(get('price')),
      cost: get('cost') === '' ? null : toNum(get('cost')),
      barcode: normBarcode(get('barcode')),
      sku: get('sku'),
    };
    out.set(cuKey(rec), rec);
  });
  if (!out.size) throw new Error('no usable rows in that file');
  return out;
}

/* Compare the two files against the catalogue and classify every row. */
async function cuBuildLines(opening, closing) {
  const products = await Store.products();
  const byKey = new Map();
  products.forEach((p) => {
    if (p.barcode) byKey.set('b:' + p.barcode, p);
    if (p.sku) byKey.set('s:' + String(p.sku).toLowerCase(), p);
    byKey.set('n:' + String(p.name || '').trim().toLowerCase(), p);
  });
  const findProduct = (r) => byKey.get(cuKey(r))
    || byKey.get('n:' + String(r.name || '').trim().toLowerCase())
    || null;

  const lines = [];
  const seen = new Set();

  for (const [key, o] of opening) {
    seen.add(key);
    const c = closing.get(key);
    const p = findProduct(o);
    const sold = c ? o.stock - c.stock : 0;

    let status = 'ok', note = '';
    if (!p) { status = 'nomatch'; note = 'not in the catalogue — import the opening file first'; }
    else if (!c) { status = 'gone'; note = 'missing from the closing file'; }
    else if (sold < 0) { status = 'restock'; note = `stock rose by ${-sold} — restocked, so sales can’t be read from it`; }
    else if (sold === 0) { status = 'nomove'; note = 'no change'; }
    else if (sold > o.stock) { status = 'suspect'; note = 'more sold than was in stock — restocked mid-period'; }

    // Price/cost from the OPENING file where present: what the shop was
    // actually charging then, not what the catalogue says today.
    const price = (o.price != null ? o.price : (p ? p.price : 0)) || 0;
    const cost = (o.cost != null ? o.cost : (p ? p.cost : 0)) || 0;

    lines.push({
      key, name: o.name, productId: p ? p.id : null,
      opening: o.stock, closing: c ? c.stock : null,
      // `restocked` is the missing term. sold = opening - closing + restocked.
      // Two snapshots cannot reveal it, so it starts at 0 and only a person
      // with the reorder figures can supply it.
      restocked: 0,
      qty: status === 'ok' || status === 'suspect' ? sold : 0,
      suggested: sold, price, cost, status, note,
    });
  }

  // Products that appear only in the closing file were added after the
  // opening count, so nothing can be said about what they sold.
  for (const [key, c] of closing) {
    if (seen.has(key)) continue;
    lines.push({
      key, name: c.name, productId: (findProduct(c) || {}).id || null,
      opening: null, closing: c.stock, qty: 0, suggested: 0,
      price: c.price || 0, cost: c.cost || 0,
      status: 'added', note: 'added after the opening count — its sales are unknown',
    });
  }

  lines.sort((a, b) => (b.qty * b.price) - (a.qty * a.price));
  return lines;
}

const CU_BADGE = {
  ok: ['green', 'sold'], suspect: ['orange', 'check'], restock: ['orange', 'restocked'],
  nomove: ['gray', 'no change'], gone: ['orange', 'missing'], added: ['blue', 'new'],
  nomatch: ['red', 'no match'],
};

function cuTotals(lines) {
  const t = { units: 0, revenue: 0, cost: 0, flagged: 0 };
  lines.forEach((l) => {
    if (l.qty > 0) { t.units += l.qty; t.revenue += l.qty * l.price; t.cost += l.qty * l.cost; }
    if (l.status !== 'ok' && l.status !== 'nomove') t.flagged++;
  });
  t.revenue = UI.roundTo(t.revenue); t.cost = UI.roundTo(t.cost);
  t.profit = UI.roundTo(t.revenue - t.cost);
  return t;
}

async function catchUpModal(root) {
  let lines = null;

  UI.modal({
    title: 'Catch-up sales from a stock count',
    wide: true,
    body: `
      <p class="tiny muted" style="margin-top:-6px">Give the product export from <b>before</b> the offline trading and the one from
        <b>after</b>. The difference is recorded as one catch-up invoice, and stock is brought down to the closing figures.</p>
      <div class="badge orange" style="display:block;padding:10px;margin-top:10px;line-height:1.6">
        ⚠ A stock difference is <b>net movement</b>, not sales — and a product that was <b>reordered</b> mid-period
        reads low with no way to detect it. Opening 22, closing 12 looks like 10 sold; if 20 were reordered, 30 were sold.
        <b>Put the reordered quantity in the “Restocked” column</b> for every product he bought more of, or the takings will be understated.
        Sale dates, discounts, payment methods and refunds are not recoverable this way at all.
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field"><label>Opening file (before)</label><input type="file" id="cu_a" accept=".xlsx,.csv" class="input"></div>
        <div class="field"><label>Closing file (after)</label><input type="file" id="cu_b" accept=".xlsx,.csv" class="input"></div>
      </div>
      <div id="cu_preview"></div>`,
    footer: `<button class="btn ghost" data-close>Cancel</button>
             <button class="btn primary" id="cu_go" disabled>Record catch-up sales</button>`
  });

  const box = document.getElementById('cu_preview');
  const go = document.getElementById('cu_go');

  const draw = () => {
    const t = cuTotals(lines);
    box.innerHTML = `
      <div class="stats" style="margin:16px 0 12px">
        <div class="stat"><div class="label">Units sold</div><div class="value mono">${UI.num(t.units)}</div></div>
        <div class="stat"><div class="label">Revenue</div><div class="value mono">${UI.money(t.revenue)}</div></div>
        <div class="stat"><div class="label">Cost of goods</div><div class="value mono">${UI.money(t.cost)}</div></div>
        <div class="stat"><div class="label">Profit</div><div class="value mono text-green">${UI.money(t.profit)}</div></div>
      </div>
      ${t.flagged ? `<div class="badge orange" style="display:block;padding:8px;margin-bottom:10px">${t.flagged} row(s) need a human — set the quantity yourself where you know it.</div>` : ''}
      <div class="form-grid">
        <div class="field"><label>Date to record it against</label><input type="date" class="input" id="cu_date" value="${UI.dayKey(Date.now())}"></div>
        <div class="field"><label>Payment</label><select class="select" id="cu_pay"><option>Cash</option><option>Card</option><option>Split</option></select></div>
      </div>
      <div class="table-wrap" style="max-height:320px;overflow:auto"><table class="tbl">
        <thead><tr><th>Product</th><th class="right">Opening</th><th class="right">Closing</th>
          <th class="right" title="Quantity reordered during the period">Restocked</th>
          <th class="right">Sold</th><th class="right">Price</th><th class="right">Line</th><th></th></tr></thead>
        <tbody>${lines.map((l, i) => {
          const [cls, label] = CU_BADGE[l.status] || ['gray', l.status];
          const dis = l.productId ? '' : 'disabled';
          return `<tr>
            <td><b>${UI.esc(l.name)}</b>${l.note ? `<div class="tiny muted">${UI.esc(l.note)}</div>` : ''}</td>
            <td class="right mono">${l.opening == null ? '—' : l.opening}</td>
            <td class="right mono">${l.closing == null ? '—' : l.closing}</td>
            <td class="right"><input class="input mono" data-r="${i}" type="number" min="0" value="${l.restocked || 0}"
                 style="width:74px;padding:6px 8px;text-align:right" ${dis}></td>
            <td class="right"><input class="input mono" data-q="${i}" type="number" min="0" value="${l.qty}"
                 style="width:74px;padding:6px 8px;text-align:right" ${dis}></td>
            <td class="right mono">${UI.money(l.price)}</td>
            <td class="right mono">${UI.money(UI.roundTo(l.qty * l.price))}</td>
            <td><span class="badge ${cls}">${label}</span></td></tr>`;
        }).join('')}</tbody></table></div>`;

    // Redraw without losing the two form fields above the table.
    const redraw = () => {
      const d = document.getElementById('cu_date').value;
      const p = document.getElementById('cu_pay').value;
      draw();
      document.getElementById('cu_date').value = d;
      document.getElementById('cu_pay').value = p;
    };
    // Entering a restock recomputes what must have sold:
    //   sold = opening − closing + restocked
    box.querySelectorAll('[data-r]').forEach((inp) => {
      inp.onchange = () => {
        const l = lines[+inp.dataset.r];
        l.restocked = Math.max(0, Math.round(+inp.value || 0));
        if (l.opening != null && l.closing != null) {
          l.qty = Math.max(0, l.opening - l.closing + l.restocked);
        }
        redraw();
      };
    });
    box.querySelectorAll('[data-q]').forEach((inp) => {
      inp.onchange = () => {
        lines[+inp.dataset.q].qty = Math.max(0, Math.round(+inp.value || 0));
        redraw();
      };
    });
    go.disabled = !lines.some((l) => l.qty > 0 && l.productId);
  };

  const tryBuild = async () => {
    const fa = document.getElementById('cu_a').files[0];
    const fb = document.getElementById('cu_b').files[0];
    if (!fa || !fb) return;
    box.innerHTML = '<div class="muted tiny" style="margin-top:14px">Reading…</div>';
    try {
      const [a, b] = await Promise.all([cuReadFile(fa), cuReadFile(fb)]);
      lines = await cuBuildLines(a, b);
      draw();
    } catch (e) {
      lines = null; go.disabled = true;
      box.innerHTML = `<div class="badge red" style="display:block;padding:10px;margin-top:14px;text-align:center">Couldn’t read the files: ${UI.esc(e.message)}</div>`;
    }
  };
  document.getElementById('cu_a').onchange = tryBuild;
  document.getElementById('cu_b').onchange = tryBuild;

  go.onclick = () => {
    const t = cuTotals(lines);
    /* Read the two fields NOW: UI.confirm reuses the same modal container, so
       by the time its callback runs this dialog's inputs no longer exist. */
    const opts = {
      date: document.getElementById('cu_date').value,
      pay: document.getElementById('cu_pay').value || 'Cash',
    };
    UI.confirm(
      `Record ${UI.num(t.units)} units as one catch-up invoice of ${UI.money(t.revenue)}? ` +
      `Stock will be reduced by the quantities shown. This cannot be undone automatically — ` +
      `take a backup first if you haven't.`,
      () => cuCommit(root, lines, opts), { danger: true });
  };
}

/* Write the catch-up invoice and bring stock down to the closing figures. */
async function cuCommit(root, lines, opts = {}) {
  // Sale lines are the ones with a quantity; stock also has to account for
  // anything reordered, including on products that sold nothing.
  const picked = lines.filter((l) => l.qty > 0 && l.productId);
  const touched = lines.filter((l) => l.productId && (l.qty > 0 || l.restocked > 0));
  if (!picked.length && !touched.length) return UI.toast('Nothing to record', 'warn');

  const dateVal = opts.date || UI.dayKey(Date.now());
  const pay = opts.pay || 'Cash';
  // Record against the chosen day's close of business, never in the future.
  let ts = dateVal ? UI.parseDayKey(dateVal).getTime() + 18 * 3600000 : Date.now();
  if (ts > Date.now()) ts = Date.now();

  const items = picked.map((l) => {
    const price = UI.roundTo(l.price);
    const cost = UI.roundTo(l.cost);
    // Same line shape completeSale writes, so refunds price these correctly
    // later (paidUnit reads `net` / `discAmt`).
    return {
      id: l.productId, name: l.name, price, qty: l.qty, cost,
      disc: null, itemDisc: 0, orderShare: 0, discAmt: 0,
      net: UI.roundTo(price * l.qty),
    };
  });

  const subtotal = UI.roundTo(items.reduce((a, i) => a + i.price * i.qty, 0));
  const cost = UI.roundTo(items.reduce((a, i) => a + i.cost * i.qty, 0));
  const no = await nextInvoiceNo();

  const sale = {
    id: UI.uid('inv'), no, ts, items,
    subtotal, discount: 0, lineDiscount: 0, orderDiscount: 0, tax: 0,
    total: subtotal, cost, profit: UI.roundTo(subtotal - cost),
    pay, cashier: App.user.name, customer: 'Walk-in Customer',
    status: 'completed', type: 'sale',
    // Marks this as reconstructed from a stock count, not a real till
    // transaction — so it can always be told apart from genuine trading.
    catchUp: true,
    note: 'Catch-up from stock count — reconstructed from opening/closing product exports',
  };

  /* Stage the stock movement. Anything reordered physically arrived, so it is
     added back as well as the sales being taken off:
        opening + restocked − sold = closing
     Without the restock leg, a corrected row would land short by exactly the
     quantity reordered. */
  const rows = [];
  const moves = [];
  for (const l of touched) {
    const p = await DB.get('products', l.productId);
    if (!p) continue;
    const restock = Math.max(0, l.restocked || 0);
    p.stock = Math.max(0, (p.stock || 0) + restock - l.qty);
    rows.push(p);
    if (restock) {
      moves.push({
        id: UI.uid('mv'), ts, product: p.name, qty: restock, reason: 'Purchase', type: 'in',
        note: 'Catch-up: reordered during the offline period', by: App.user.name,
      });
    }
  }

  if (picked.length) await DB.put('sales', sale);
  if (rows.length) await DB.bulk('products', rows);
  if (moves.length) await DB.bulk('stockMoves', moves);
  Store.bust();

  // Did stock actually land on the closing figures? Report honestly.
  const off = [];
  for (const l of touched) {
    if (l.closing == null) continue;
    const p = rows.find((r) => r.id === l.productId);
    if (p && p.stock !== l.closing) off.push(`${l.name}: ${p.stock} vs ${l.closing} in the file`);
  }

  UI.close();
  UI.toast(`Catch-up invoice #${no} recorded · ${UI.money(subtotal)}`);
  if (off.length) {
    UI.modal({
      title: 'Recorded — but stock doesn’t match the closing file',
      body: `<p class="tiny muted">The invoice was written and the money is on the books. These products did not land on
        their closing figure, which usually means they were restocked during the period:</p>
        <div class="tiny mono" style="margin-top:10px;max-height:240px;overflow:auto">${off.map((s) => UI.esc(s)).join('<br>')}</div>
        <p class="tiny muted" style="margin-top:10px">Correct them with Inventory → Adjust Stock.</p>`,
      footer: '<button class="btn primary" data-close>Got it</button>'
    });
  }
  if (root) Views.backup(root);
}
