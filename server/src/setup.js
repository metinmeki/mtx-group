'use strict';
/* One command to stand up (or update) every store's database:
 *
 *   npm run setup
 *
 * For each store in STORES it will:
 *   1. CREATE DATABASE mtx_<store>   (only if it doesn't exist)
 *   2. apply the schema               (idempotent — safe to re-run any time)
 *   3. create an "Owner Admin" user   (only if the store has no users yet)
 *
 * Safe to run repeatedly. It never drops or clears anything.
 */
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const { migrate } = require('./migrate');

async function ensureDatabase(store) {
  const name = config.dbNameFor(store);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing to create unsafe database name: ${name}`);
  const admin = db.adminPool();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (rowCount) {
    console.log(`  database ${name} — exists`);
    return;
  }
  // Identifiers can't be parameterised; `name` is validated above.
  await admin.query(`CREATE DATABASE ${name}`);
  console.log(`  database ${name} — created`);
}

async function ensureDefaultAdmin(store) {
  const { rowCount } = await db.query(store, 'SELECT 1 FROM users WHERE deleted = false LIMIT 1');
  if (rowCount) {
    console.log('  users — already present, skipping default admin');
    return;
  }
  const hash = bcrypt.hashSync(String(config.defaultAdminPin), config.bcryptRounds);
  await db.query(
    store,
    `INSERT INTO users (id, name, role, active, pin_hash) VALUES ($1, $2, $3, true, $4)`,
    ['u_admin', 'Owner Admin', 'Super Admin', hash],
  );
  console.log(`  users — created "Owner Admin" (PIN ${config.defaultAdminPin} — change it in the app)`);
}

async function main() {
  const problems = config.assertProductionReady();
  if (problems.length && config.env === 'production') {
    console.warn('Config warnings:\n  - ' + problems.join('\n  - ') + '\n');
  }
  if (!config.stores.length) throw new Error('STORES is empty — nothing to set up');

  console.log(`Setting up ${config.stores.length} store database(s) on ${config.pg.host}:${config.pg.port}\n`);
  for (const store of config.stores) {
    console.log(`[${store}]  ->  ${config.dbNameFor(store)}`);
    await ensureDatabase(store);
    await migrate(store);
    await ensureDefaultAdmin(store);
    console.log('');
  }
  await db.closeAll();
  console.log('Setup complete.');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  console.error(err);
  process.exit(1);
});
