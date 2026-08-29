'use strict';
/* Builds the per-store database schema as one idempotent SQL script.

   Every table follows the same sync-friendly shape:
     <pk>          TEXT PRIMARY KEY        the record's id (or `key` for settings)
     data          JSONB                  the full record, exactly as the app stores it
     deleted       BOOLEAN                 soft delete, so tombstones can sync
     client_mtime  BIGINT                 wall-clock ms of the client write — drives
                                          last-write-wins conflict resolution
     seq           BIGINT                 position in this database's global change
                                          order; the sync feed is "give me every row
                                          with seq > my cursor". Filled from a shared
                                          sequence on insert; bumped explicitly on
                                          every update (see sync.js / users.js).
     updated_at    TIMESTAMPTZ            server clock, for humans / debugging

   `users` is separate: it carries real auth columns and never keeps a PIN in
   `data`. */

const { SYNC_TABLES } = require('./tables');

const PRELUDE = `
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE SEQUENCE IF NOT EXISTS change_seq;
`;

function recordTable(name, pk) {
  return `
CREATE TABLE IF NOT EXISTS ${name} (
  ${pk}         TEXT PRIMARY KEY,
  data         JSONB,
  deleted      BOOLEAN     NOT NULL DEFAULT false,
  client_mtime BIGINT      NOT NULL DEFAULT 0,
  seq          BIGINT      NOT NULL DEFAULT nextval('change_seq'),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_${name}_seq ON ${name} (seq);
`;
}

const USERS = `
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  name         TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'Cashier',
  email        TEXT,
  active       BOOLEAN     NOT NULL DEFAULT true,
  pin_hash     TEXT        NOT NULL,
  deleted      BOOLEAN     NOT NULL DEFAULT false,
  client_mtime BIGINT      NOT NULL DEFAULT 0,
  seq          BIGINT      NOT NULL DEFAULT nextval('change_seq'),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_seq ON users (seq);
`;

function buildSchemaSQL() {
  const parts = [PRELUDE];
  for (const t of SYNC_TABLES) parts.push(recordTable(t.sql, t.key || 'id'));
  parts.push(USERS);
  return parts.join('\n');
}

module.exports = { buildSchemaSQL };
