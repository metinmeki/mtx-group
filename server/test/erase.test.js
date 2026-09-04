'use strict';
/* Integration test for POST /api/erase (sync.eraseData) against an in-memory
   PostgreSQL, using the real schema.

   The behaviour that matters: erasing must put the removals INTO the change
   feed as tombstones. A hard DELETE would drop the rows out of the feed, so
   other terminals would never learn they were deleted, keep their local
   copies, and push them straight back on the next sync.

   Run: node test/erase.test.js
*/
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-for-production-use-only-please';
process.env.STORES = 'melora,bangeen';

const assert = require('assert');
const Module = require('module');
const { newDb } = require('pg-mem');

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
const pg = mem.adapters.createPg();

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'pg') return pg;
  return origLoad.call(this, request, ...rest);
};

const { buildSchemaSQL } = require('../src/schema');
const db = require('../src/db');
const sync = require('../src/sync');

const STORE = 'melora';
let passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(`  ok    ${name}`); passed++; }
  catch (e) { results.push(`  FAIL  ${name}\n        ${e.stack || e.message}`); process.exitCode = 1; }
}

(async () => {
  await db.query(STORE, buildSchemaSQL());

  // Two terminals' worth of trading data, pushed the way a client would.
  await sync.push(STORE, [
    { store: 'products', id: 'p1', data: { id: 'p1', name: 'Serum', stock: 40 }, mtime: 1000 },
    { store: 'products', id: 'p2', data: { id: 'p2', name: 'Vase', stock: 10 }, mtime: 1000 },
    { store: 'sales', id: 's1', data: { id: 's1', no: 1001, total: 160 }, mtime: 1000 },
    { store: 'sales', id: 's2', data: { id: 's2', no: 1002, total: 78 }, mtime: 1000 },
    { store: 'customers', id: 'c1', data: { id: 'c1', name: 'Lana', debt: 32 }, mtime: 1000 },
    { store: 'settings', id: 'store', data: { name: 'Melora', currency: 'USD' }, mtime: 1000 },
  ]);

  // A terminal that is already up to date, so we can prove it learns about
  // the erase rather than silently keeping its copies.
  const before = await sync.pull(STORE, 0, 5000);
  const cursorBefore = before.cursor;

  await test('data is present before the erase', () => {
    assert.strictEqual(before.changes.products.length, 2);
    assert.strictEqual(before.changes.sales.length, 2);
    assert.strictEqual(before.changes.customers.length, 1);
  });

  const res = await sync.eraseData(STORE);

  await test('erase reports what it cleared', () => {
    assert.strictEqual(res.cleared.products, 2);
    assert.strictEqual(res.cleared.sales, 2);
    assert.strictEqual(res.cleared.customers, 1);
  });

  await test('settings are NOT erased (store name, currency must survive)', async () => {
    const { rows } = await db.query(STORE, "SELECT data, deleted FROM settings WHERE key = 'store'");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].deleted, false);
    assert.strictEqual(rows[0].data.name, 'Melora');
  });

  await test('rows are tombstoned, not dropped', async () => {
    const { rows } = await db.query(STORE, 'SELECT id, deleted, data FROM products ORDER BY id');
    assert.strictEqual(rows.length, 2, 'rows must still exist as tombstones');
    assert.ok(rows.every((r) => r.deleted === true), 'every row marked deleted');
    assert.ok(rows.every((r) => r.data === null), 'payload cleared');
  });

  await test('an up-to-date terminal is told to delete them', async () => {
    const after = await sync.pull(STORE, cursorBefore, 5000);
    const ids = (after.changes.products || []).map((r) => r.id).sort();
    assert.deepStrictEqual(ids, ['p1', 'p2'], 'both products appear in the feed after the erase');
    assert.ok((after.changes.products || []).every((r) => r.deleted === true), 'as deletions');
    assert.ok((after.changes.sales || []).every((r) => r.deleted === true), 'sales too');
  });

  await test('a fresh terminal syncing from zero gets nothing to create', async () => {
    const fresh = await sync.pull(STORE, 0, 5000);
    const live = Object.entries(fresh.changes)
      .filter(([s]) => s !== 'settings')
      .flatMap(([, rows]) => rows)
      .filter((r) => !r.deleted);
    assert.deepStrictEqual(live, [], 'nothing but tombstones outside settings');
  });

  await test('a terminal pushing an old copy back does not resurrect it', async () => {
    // Stale client still holding p1 pushes it with its ORIGINAL mtime.
    const out = await sync.push(STORE, [
      { store: 'products', id: 'p1', data: { id: 'p1', name: 'Serum', stock: 40 }, mtime: 1000 },
    ]);
    assert.strictEqual(out.applied.length, 0, 'stale write rejected');
    assert.strictEqual(out.conflicts.length, 1, 'reported as a conflict');
    const { rows } = await db.query(STORE, "SELECT deleted FROM products WHERE id = 'p1'");
    assert.strictEqual(rows[0].deleted, true, 'still deleted');
  });

  await test('erasing an already-empty store is harmless', async () => {
    const again = await sync.eraseData(STORE);
    assert.strictEqual(again.cleared.products, 0);
    assert.strictEqual(again.cleared.sales, 0);
  });

  await db.closeAll().catch(() => {});
  console.log('\nerase.test.js');
  results.forEach((r) => console.log(r));
  console.log(`\n  ${passed}/${results.length} passed\n`);
})().catch((e) => { console.error(e); process.exit(1); });
