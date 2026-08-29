'use strict';
/* No-database sanity checks: every module loads, the generated SQL looks sane,
   and the Express app mounts. Run with `npm run smoke`.
   Full integration testing needs a real PostgreSQL (see README). */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production-use-only';
process.env.STORES = process.env.STORES || 'melora,bangeen';

const assert = require('assert');

let pass = 0;
const checks = [];
const ok = (name, fn) => checks.push({ name, fn });

const config = require('../src/config');
ok('config: two stores', () => assert.deepStrictEqual(config.stores, ['melora', 'bangeen']));
ok('config: per-store db names', () => {
  assert.strictEqual(config.dbNameFor('melora'), 'mtx_melora');
  assert.strictEqual(config.dbNameFor('bangeen'), 'mtx_bangeen');
});
ok('config: unknown store rejected', () => assert.throws(() => config.dbNameFor('nope')));

const { buildSchemaSQL } = require('../src/schema');
const sql = buildSchemaSQL();
ok('schema: shared change sequence', () => {
  assert.ok(sql.includes('CREATE SEQUENCE IF NOT EXISTS change_seq'));
});
ok('schema: table + seq default + index per synced store', () => {
  const { SYNC_TABLES } = require('../src/tables');
  for (const t of SYNC_TABLES) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t.sql} (`), `missing table ${t.sql}`);
    assert.ok(sql.includes(`idx_${t.sql}_seq`), `missing index for ${t.sql}`);
  }
  assert.ok(sql.includes("seq          BIGINT      NOT NULL DEFAULT nextval('change_seq')"));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS users ('));
  assert.ok(sql.includes('pin_hash'));
});
ok('schema: settings keyed by `key`', () => assert.ok(/settings \(\s*key\s+TEXT PRIMARY KEY/.test(sql)));

const sync = require('../src/sync');
ok('sync: module shape', () => {
  assert.strictEqual(typeof sync.pull, 'function');
  assert.strictEqual(typeof sync.push, 'function');
});
ok('sync: push rejects a non-array', () => assert.rejects(() => sync.push('melora', 'nope')));

ok('server: app mounts', () => {
  const { createApp } = require('../src/server');
  assert.strictEqual(typeof createApp(), 'function');
});
ok('auth + users load without side effects', () => {
  require('../src/auth');
  require('../src/users');
});

(async () => {
  for (const c of checks) {
    try {
      await c.fn();
      console.log(`  ok    ${c.name}`);
      pass++;
    } catch (e) {
      console.error(`  FAIL  ${c.name}\n        ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${pass}/${checks.length} checks passed.`);
})();
