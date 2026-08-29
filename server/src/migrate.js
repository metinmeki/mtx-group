'use strict';
/* Applies the schema to one store database. Idempotent — every statement uses
   IF NOT EXISTS / OR REPLACE, so running it again is safe and is how future
   schema changes roll out. */
const db = require('./db');
const { buildSchemaSQL } = require('./schema');

const SCHEMA_VERSION = '1';

async function migrate(store) {
  await db.query(store, buildSchemaSQL());
  await db.query(
    store,
    `INSERT INTO _meta (key, value) VALUES ('schema_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SCHEMA_VERSION],
  );
}

module.exports = { migrate, SCHEMA_VERSION };
