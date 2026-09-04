'use strict';
/* The sync engine. Two operations, both scoped to the caller's store:

   pull(since)            "give me every change after cursor `since`"
                          -> { cursor, hasMore, changes: { <store>: [rows] } }

   push(changes)          "here are my local writes"
                          -> { applied: [...], conflicts: [...] }

   Conflict rule: last write wins, decided by `client_mtime` (the wall-clock ms
   the client stamped on its write). If the row already on the server has a
   newer client_mtime, the incoming write is rejected as a conflict and the
   client should pull to pick up the winning version.

   `users` appears in the pull feed (sanitised — no PIN hash) so the login
   screen and Users & Roles page work offline, but is never accepted on push;
   user changes go through /api/users. */
const db = require('./db');
const { SYNC_TABLES, BY_STORE, PROTECTED_SETTINGS } = require('./tables');

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

/* One UNION ALL across every generic table, ordered by the global change
   counter. A row that changed several times appears once, at its latest seq.
   `users` is fetched separately and sanitised (no PIN hash) before merging. */
const FEED_SQL = (() => {
  const parts = SYNC_TABLES.map((t) => {
    const pk = t.key || 'id';
    return `SELECT '${t.store}'::text AS store, ${pk}::text AS id, data, deleted, seq FROM ${t.sql} WHERE seq > $1`;
  });
  return `SELECT store, id, data, deleted, seq
            FROM ( ${parts.join(' UNION ALL ')} ) feed
           ORDER BY seq ASC
           LIMIT $2`;
})();

const USERS_FEED_SQL =
  `SELECT id, name, role, active, email, deleted, seq
     FROM users WHERE seq > $1 ORDER BY seq ASC LIMIT $2`;

async function pull(store, since, limit) {
  const cursorIn = Math.max(0, Number(since) || 0);
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const [generic, users] = await Promise.all([
    db.query(store, FEED_SQL, [cursorIn, lim]),
    db.query(store, USERS_FEED_SQL, [cursorIn, lim]),
  ]);

  const merged = [
    ...generic.rows.map((r) => ({ store: r.store, id: r.id, deleted: r.deleted, data: r.data, seq: Number(r.seq) })),
    ...users.rows.map((r) => ({
      store: 'users', id: r.id, deleted: r.deleted, seq: Number(r.seq),
      data: { id: r.id, name: r.name, role: r.role, active: r.active, email: r.email },
    })),
  ].sort((a, b) => a.seq - b.seq);

  const page = merged.slice(0, lim);
  const changes = {};
  let cursor = cursorIn;
  for (const row of page) {
    (changes[row.store] || (changes[row.store] = [])).push({ id: row.id, deleted: row.deleted, data: row.data });
    if (row.seq > cursor) cursor = row.seq;
  }

  const hasMore = merged.length > lim || generic.rows.length === lim || users.rows.length === lim;
  // serverTime lets each terminal correct its clock skew, so last-write-wins
  // stays fair even when the tills' clocks drift apart.
  return { cursor, hasMore, changes, serverTime: Date.now() };
}

async function push(store, changes) {
  if (!Array.isArray(changes)) {
    const e = new Error('changes must be an array'); e.status = 400; throw e;
  }
  const applied = [];
  const conflicts = [];

  await db.withTx(store, async (client) => {
    for (const c of changes) {
      const table = BY_STORE[c && c.store];
      if (!table) { conflicts.push({ store: c && c.store, id: c && c.id, reason: 'unknown-store' }); continue; }
      if (c.store === 'settings' && PROTECTED_SETTINGS.has(c.id)) {
        conflicts.push({ store: c.store, id: c.id, reason: 'server-owned' });
        continue;
      }
      const pk = table.key || 'id';
      const id = String(c.id);
      const mtime = Number(c.mtime) || Date.now();
      const payload = c.data == null ? null : JSON.stringify(c.data);

      // Lock the row (if it exists) and reject a write that's older than what
      // the server already has — last write wins by client wall clock.
      const existing = await client.query(
        `SELECT client_mtime FROM ${table.sql} WHERE ${pk} = $1 FOR UPDATE`,
        [id],
      );
      if (existing.rowCount && Number(existing.rows[0].client_mtime) > mtime) {
        conflicts.push({ store: c.store, id: c.id, reason: 'stale' });
        continue;
      }

      await client.query(
        `INSERT INTO ${table.sql} (${pk}, data, deleted, client_mtime)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (${pk}) DO UPDATE
           SET data = EXCLUDED.data,
               deleted = EXCLUDED.deleted,
               client_mtime = EXCLUDED.client_mtime,
               seq = nextval('change_seq'),
               updated_at = now()`,
        [id, payload, !!c.deleted, mtime],
      );
      applied.push({ store: c.store, id: c.id });
    }
  });

  return { applied, conflicts };
}

/* Erase every business record in a store, everywhere.

   Rows are TOMBSTONED (deleted = true, seq bumped), not dropped. A hard DELETE
   would remove them from the change feed entirely, so other terminals would
   never learn they are gone — they would keep their local copies and push them
   straight back on the next sync. Marking them deleted puts the removal INTO
   the feed, so every terminal that syncs clears itself down too.

   `users` is left alone: wiping the staff list would lock everyone out of the
   store, including whoever pressed the button. Settings are kept for the same
   practical reason — store name, currency and receipt details are configuration,
   not trading data, and the app expects them to exist. */
async function eraseData(store) {
  const cleared = {};
  await db.withTx(store, async (client) => {
    for (const t of SYNC_TABLES) {
      if (t.store === 'settings') continue;
      const pk = t.key || 'id';
      const { rowCount } = await client.query(
        `UPDATE ${t.sql}
            SET deleted = true, data = NULL, client_mtime = $1,
                seq = nextval('change_seq'), updated_at = now()
          WHERE deleted = false`,
        [Date.now()],
      );
      cleared[t.store] = rowCount;
      void pk;
    }
  });
  return { cleared };
}

module.exports = { pull, push, eraseData };
