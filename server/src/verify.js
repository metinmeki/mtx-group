'use strict';
/* Verify a cut-over: compare a Backup & Restore export against what actually
 * landed in the store's database.
 *
 *   node src/verify.js <store> <path-to-backup.json>
 *
 * Read-only — it never writes, so it is safe to run against a live database.
 *
 * Run it straight after `import.js`. Eyeballing the dashboard is not
 * verification: a missing table, a truncated import or a half-applied
 * transaction can still leave a screen that looks plausible. This recomputes
 * the money from both sides and tells you, line by line, whether they agree.
 *
 * Exit code 0 = everything matches, 1 = at least one mismatch.
 */
const fs = require('fs');
const config = require('./config');
const db = require('./db');
const { SYNC_TABLES } = require('./tables');

/* Money is compared in whole minor units (cents / fils) so floating-point
   noise can never fail an otherwise-correct cut-over. */
const cents = (n) => Math.round((Number(n) || 0) * 100);
const money = (n) => (Number(n) || 0).toFixed(2);

function sum(rows, pick) {
  return rows.reduce((a, r) => a + (Number(pick(r)) || 0), 0);
}

/* ---- figures we can compute identically from both sides ---- */
function summarise(d) {
  const sales = d.sales || [];
  const products = d.products || [];
  const customers = d.customers || [];
  const suppliers = d.suppliers || [];
  const expenses = d.expenses || [];

  const nos = sales.map((s) => Number(s.no) || 0).filter(Boolean);
  const byType = {};
  sales.forEach((s) => { const t = s.type || 'sale'; byType[t] = (byType[t] || 0) + 1; });

  // A duplicate invoice number is the one thing that silently corrupts refunds
  // later on (refundOf matches by number), so it is checked explicitly.
  const seen = new Set(), dupes = new Set();
  nos.forEach((n) => { if (seen.has(n)) dupes.add(n); seen.add(n); });

  return {
    'products'            : products.length,
    'categories'          : (d.categories || []).length,
    'customers'           : customers.length,
    'suppliers'           : suppliers.length,
    'sales rows'          : sales.length,
    '  of which sales'    : byType.sale || 0,
    '  of which refunds'  : byType.refund || 0,
    '  of which exchanges': byType.exchange || 0,
    'expenses'            : expenses.length,
    'stock moves'         : (d.stockMoves || []).length,
    'purchases'           : (d.purchases || []).length,
    'payments'            : (d.payments || []).length,
    'users'               : (d.users || []).length,

    'net revenue'         : cents(sum(sales, (s) => s.total)),
    'net profit'          : cents(sum(sales, (s) => s.profit)),
    'cost of goods'       : cents(sum(sales, (s) => s.cost)),
    'discounts given'     : cents(sum(sales, (s) => s.discount)),
    'total expenses'      : cents(sum(expenses, (e) => e.amount)),
    'customer debt'       : cents(sum(customers, (c) => c.debt)),
    'supplier debt'       : cents(sum(suppliers, (s) => s.debt)),

    'stock units'         : sum(products, (p) => p.stock),
    'inventory value'     : cents(products.reduce((a, p) => a + (Number(p.cost) || 0) * (Number(p.stock) || 0), 0)),

    'lowest invoice no.'  : nos.length ? Math.min(...nos) : 0,
    'highest invoice no.' : nos.length ? Math.max(...nos) : 0,
    'duplicate inv. nos.' : dupes.size,
  };
}

const MONEY_KEYS = new Set([
  'net revenue', 'net profit', 'cost of goods', 'discounts given',
  'total expenses', 'customer debt', 'supplier debt', 'inventory value',
]);

async function readDb(store) {
  const d = {};
  for (const t of SYNC_TABLES) {
    if (t.store === 'settings') continue;
    const { rows } = await db.query(store, `SELECT data FROM ${t.sql} WHERE deleted = false`);
    d[t.store] = rows.map((r) => r.data);
  }
  const users = await db.query(store, 'SELECT id FROM users WHERE deleted = false');
  d.users = users.rows;
  return d;
}

async function main() {
  const [store, file] = process.argv.slice(2);
  if (!store || !file) {
    console.error('usage: node src/verify.js <store> <backup.json>');
    process.exit(1);
  }
  if (!config.stores.includes(store)) {
    console.error(`unknown store "${store}" — STORES is [${config.stores.join(', ')}]`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const backup = raw.data || raw;
  if (raw.meta && raw.meta.store && raw.meta.store !== store) {
    console.warn(`WARNING: backup is stamped store="${raw.meta.store}" but you are verifying "${store}"\n`);
  }

  const a = summarise(backup);
  const b = summarise(await readDb(store));

  // The invoice counter must survive, or the online till restarts numbering
  // at 1001 and issues numbers the offline copy already used.
  const seqRow = await db.query(store, "SELECT data FROM settings WHERE key = 'invoiceSeq'");
  const seqOnServer = seqRow.rows.length ? Number(seqRow.rows[0].data) : null;
  const seqInBackup = (backup.settings || []).find((s) => s && s.key === 'invoiceSeq');
  const seqLocal = seqInBackup ? Number(seqInBackup.value) : null;

  await db.closeAll();

  const w = Math.max(...Object.keys(a).map((k) => k.length));
  const fmt = (k, v) => (MONEY_KEYS.has(k) ? money(v / 100) : String(v));
  let bad = 0;

  console.log(`\nCut-over check — ${config.dbNameFor(store)}\n`);
  console.log(`  ${'figure'.padEnd(w)}   ${'backup file'.padStart(14)}   ${'on server'.padStart(14)}`);
  console.log(`  ${'-'.repeat(w)}   ${'-'.repeat(14)}   ${'-'.repeat(14)}`);
  for (const k of Object.keys(a)) {
    const ok = a[k] === b[k];
    if (!ok) bad++;
    console.log(`  ${k.padEnd(w)}   ${fmt(k, a[k]).padStart(14)}   ${fmt(k, b[k]).padStart(14)}   ${ok ? 'ok' : '<< MISMATCH'}`);
  }

  console.log('');
  if (a['duplicate inv. nos.'] > 0) {
    console.log(`  !! the backup itself contains ${a['duplicate inv. nos.']} duplicate invoice number(s)`);
    console.log('     refunds match their original by number, so these must be resolved.');
    bad++;
  }
  if (seqOnServer == null) {
    console.log('  !! invoiceSeq is missing on the server — the online till would restart');
    console.log('     numbering at 1001 and reissue numbers already used offline.');
    bad++;
  } else {
    const okSeq = seqLocal == null || seqOnServer >= seqLocal;
    const okAbove = seqOnServer >= (a['highest invoice no.'] || 0);
    console.log(`  invoiceSeq on server: ${seqOnServer}${seqLocal != null ? ` (backup: ${seqLocal})` : ''} ` +
      `${okSeq && okAbove ? 'ok' : '<< TOO LOW — next sale would reuse a number'}`);
    if (!(okSeq && okAbove)) bad++;
  }

  console.log(bad === 0
    ? '\n  PASS — the server holds exactly what the offline copy held.\n'
    : `\n  FAIL — ${bad} problem(s) above. Do not cut over until these are resolved.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nVerify failed:', err.message);
    console.error(err);
    process.exit(1);
  });
}

// exported so the figures can be unit-tested without a database
module.exports = { summarise, MONEY_KEYS };
