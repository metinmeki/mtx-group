'use strict';
/* Integration test for the sync engine against an in-memory PostgreSQL
   (pg-mem). Exercises the real schema, the seq trigger, and pull/push
   including last-write-wins conflict handling.

   Run: npm run itest   (pg-mem is a devDependency; not needed in production) */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-for-production-use-only-please';
process.env.STORES = 'melora,bangeen';

const assert = require('assert');
const Module = require('module');
const { newDb } = require('pg-mem');

/* One in-memory database per store, swapped in for the real `pg` module. */
const mems = { melora: newDb(), bangeen: newDb() };
const pgFor = {};
for (const [store, mem] of Object.entries(mems)) {
  mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
  pgFor[store] = mem.adapters.createPg();
}

let currentStore = 'melora';
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'pg') return pgFor[currentStore];
  return origLoad.call(this, request, ...rest);
};

const { buildSchemaSQL } = require('../src/schema');

/* db.js caches a Pool per store on first use; since we hand each store its own
   pg module we must require a fresh copy of db.js bound to the right module. */
function dbFor(store) {
  currentStore = store;
  const p = require.resolve('../src/db');
  delete require.cache[p];
  return require('../src/db');
}

let passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(`  ok    ${name}`); passed++; }
  catch (e) { results.push(`  FAIL  ${name}\n        ${e.stack || e.message}`); process.exitCode = 1; }
}

(async () => {
  // --- schema applies on both store databases ---
  for (const store of ['melora', 'bangeen']) {
    const db = dbFor(store);
    await db.query(store, buildSchemaSQL());
  }
  await test('schema applies to each store database', () => {});

  // work with the melora store for the behaviour tests
  const store = 'melora';
  currentStore = store;
  delete require.cache[require.resolve('../src/sync')];
  delete require.cache[require.resolve('../src/db')];
  const db = require('../src/db');
  const sync = require('../src/sync');

  await test('pull on an empty store returns nothing', async () => {
    const r = await sync.pull(store, 0);
    assert.strictEqual(r.cursor, 0);
    assert.strictEqual(r.hasMore, false);
    assert.deepStrictEqual(r.changes, {});
  });

  await test('push inserts a product and pull returns it', async () => {
    const res = await sync.push(store, [
      { store: 'products', id: 'p1', data: { id: 'p1', name: 'Vase', price: 5000, stock: 3 }, mtime: 1000 },
    ]);
    assert.strictEqual(res.applied.length, 1);
    assert.strictEqual(res.conflicts.length, 0);

    const pulled = await sync.pull(store, 0);
    assert.ok(pulled.changes.products, 'products in feed');
    assert.strictEqual(pulled.changes.products[0].id, 'p1');
    assert.strictEqual(pulled.changes.products[0].data.name, 'Vase');
    assert.ok(pulled.cursor > 0, 'cursor advanced');
  });

  let cursorAfterFirst;
  await test('pull with a cursor only returns newer changes', async () => {
    const all = await sync.pull(store, 0);
    cursorAfterFirst = all.cursor;
    const nothingNew = await sync.pull(store, cursorAfterFirst);
    assert.deepStrictEqual(nothingNew.changes, {});
    assert.strictEqual(nothingNew.cursor, cursorAfterFirst);
  });

  await test('newer client_mtime wins, older is a conflict', async () => {
    const win = await sync.push(store, [
      { store: 'products', id: 'p1', data: { id: 'p1', name: 'Vase', price: 5000, stock: 1 }, mtime: 2000 },
    ]);
    assert.strictEqual(win.applied.length, 1);

    const stale = await sync.push(store, [
      { store: 'products', id: 'p1', data: { id: 'p1', name: 'Vase OLD', price: 9999, stock: 99 }, mtime: 1500 },
    ]);
    assert.strictEqual(stale.applied.length, 0);
    assert.strictEqual(stale.conflicts.length, 1);
    assert.strictEqual(stale.conflicts[0].reason, 'stale');

    const now = await sync.pull(store, 0);
    const p1 = now.changes.products.find((x) => x.id === 'p1');
    assert.strictEqual(p1.data.stock, 1, 'winning value kept');
  });

  await test('soft delete syncs as a tombstone', async () => {
    await sync.push(store, [
      { store: 'products', id: 'p1', data: { id: 'p1', name: 'Vase' }, deleted: true, mtime: 3000 },
    ]);
    const now = await sync.pull(store, 0);
    const p1 = now.changes.products.find((x) => x.id === 'p1');
    assert.strictEqual(p1.deleted, true);
  });

  await test('settings sync, but invoiceSeq is refused', async () => {
    const res = await sync.push(store, [
      { store: 'settings', id: 'currency', data: 'IQD', mtime: 100 },
      { store: 'settings', id: 'invoiceSeq', data: 1, mtime: 100 },
    ]);
    assert.strictEqual(res.applied.length, 1);
    assert.strictEqual(res.conflicts.length, 1);
    assert.strictEqual(res.conflicts[0].id, 'invoiceSeq');
    assert.strictEqual(res.conflicts[0].reason, 'server-owned');

    const now = await sync.pull(store, 0);
    const cur = (now.changes.settings || []).find((s) => s.id === 'currency');
    assert.strictEqual(cur.data, 'IQD');
    assert.ok(!(now.changes.settings || []).some((s) => s.id === 'invoiceSeq'), 'invoiceSeq not stored');
  });

  await test('a sale round-trips with its nested items intact', async () => {
    const sale = {
      id: 'inv1', no: 'A-1001', ts: Date.now(), type: 'sale', channel: 'catpos',
      items: [{ id: 'c1', name: 'Blnd', price: 5000, qty: 1, net: 4500, discAmt: 500 }],
      subtotal: 5000, discount: 500, total: 4500, pay: 'Cash',
    };
    await sync.push(store, [{ store: 'sales', id: 'inv1', data: sale, mtime: 5000 }]);
    const now = await sync.pull(store, 0);
    const got = now.changes.sales.find((s) => s.id === 'inv1');
    assert.strictEqual(got.data.items[0].name, 'Blnd');
    assert.strictEqual(got.data.total, 4500);
  });

  await test('stores are isolated — bangeen never saw melora writes', async () => {
    currentStore = 'bangeen';
    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/sync')];
    const bSync = require('../src/sync');
    const b = await bSync.pull('bangeen', 0);
    assert.deepStrictEqual(b.changes, {});
    currentStore = 'melora';
  });

  Module._load = origLoad;
  console.log(results.join('\n'));
  console.log(`\n${passed}/${results.length} checks passed.`);
})().catch((e) => { console.error(e); process.exit(1); });
