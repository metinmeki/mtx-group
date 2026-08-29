'use strict';
/* One-time migration: load a Backup & Restore export (the JSON the app produces
 * from Backup & Restore -> Export) into a store's database.
 *
 *   node src/import.js <store> <path-to-backup.json> [--wipe]
 *
 *   --wipe   clear the store's tables first (a clean import). Without it,
 *            records are upserted (existing ids updated, new ones added).
 *
 * PINs in the old local backup are plaintext; they are bcrypt-hashed on the way
 * in and the plaintext is dropped.
 *
 * Recommended: import into a staging database first, run the app against it,
 * check the totals match, then do the real cut-over.
 */
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const { SYNC_TABLES } = require('./tables');

async function main() {
  const [store, file, ...flags] = process.argv.slice(2);
  if (!store || !file) {
    console.error('usage: node src/import.js <store> <backup.json> [--wipe]');
    process.exit(1);
  }
  if (!config.stores.includes(store)) {
    console.error(`unknown store "${store}" — STORES is [${config.stores.join(', ')}]`);
    process.exit(1);
  }
  const wipe = flags.includes('--wipe');

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = raw.data || raw; // tolerate a bare { table: [...] } too
  if (raw.meta && raw.meta.store && raw.meta.store !== store) {
    console.warn(`WARNING: this backup is stamped store="${raw.meta.store}" but you are importing into "${store}".`);
  }

  const mtime = Date.now();
  const counts = {};

  await db.withTx(store, async (client) => {
    if (wipe) {
      for (const t of SYNC_TABLES) await client.query(`DELETE FROM ${t.sql}`);
      await client.query('DELETE FROM users');
      console.log('wiped existing tables');
    }

    for (const t of SYNC_TABLES) {
      const rows = Array.isArray(data[t.store]) ? data[t.store] : [];
      const pk = t.key || 'id';
      for (const rec of rows) {
        if (rec == null) continue;
        const id = rec[pk];
        if (id == null) continue;
        // settings rows are { key, value } — store the value as `data`
        const body = t.store === 'settings' ? (rec.value ?? null) : rec;
        await client.query(
          `INSERT INTO ${t.sql} (${pk}, data, deleted, client_mtime)
           VALUES ($1, $2::jsonb, false, $3)
           ON CONFLICT (${pk}) DO UPDATE
             SET data = EXCLUDED.data, deleted = false, client_mtime = EXCLUDED.client_mtime,
                 seq = nextval('change_seq'), updated_at = now()`,
          [String(id), JSON.stringify(body ?? null), mtime],
        );
      }
      counts[t.store] = rows.length;
    }

    // users — hash the old plaintext PIN
    const users = Array.isArray(data.users) ? data.users : [];
    for (const u of users) {
      if (!u || u.id == null) continue;
      const hash = u.pin != null && u.pin !== ''
        ? bcrypt.hashSync(String(u.pin), config.bcryptRounds)
        : bcrypt.hashSync('0000', config.bcryptRounds);
      await client.query(
        `INSERT INTO users (id, name, role, email, active, pin_hash, deleted, client_mtime)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name, role = EXCLUDED.role, email = EXCLUDED.email,
               active = EXCLUDED.active, pin_hash = EXCLUDED.pin_hash,
               deleted = false, client_mtime = EXCLUDED.client_mtime,
               seq = nextval('change_seq'), updated_at = now()`,
        [String(u.id), u.name || 'User', u.role || 'Cashier', u.email || null, u.active !== false, hash, mtime],
      );
    }
    counts.users = `${users.length} (PINs hashed)`;
  });

  await db.closeAll();
  console.log(`\nImported into ${config.dbNameFor(store)}:`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
}

main().catch((err) => {
  console.error('\nImport failed:', err.message);
  console.error(err);
  process.exit(1);
});
