'use strict';
/* PostgreSQL connection pools — one per store database, opened lazily.
   Melora and Bangeen never share a connection or a database. */
const { Pool } = require('pg');
const config = require('./config');

const pools = new Map();

function baseOptions() {
  const opts = {
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
  if (config.pg.ssl) opts.ssl = { rejectUnauthorized: false };
  return opts;
}

/* Pool for one store's database. */
function poolFor(store) {
  if (!config.stores.includes(store)) {
    const err = new Error(`Unknown store: ${store}`);
    err.status = 404;
    throw err;
  }
  if (!pools.has(store)) {
    pools.set(store, new Pool({ ...baseOptions(), database: config.dbNameFor(store) }));
  }
  return pools.get(store);
}

/* Pool against the admin database — used only by setup.js to CREATE DATABASE. */
function adminPool() {
  const key = '__admin__';
  if (!pools.has(key)) {
    pools.set(key, new Pool({ ...baseOptions(), database: config.pg.adminDatabase, max: 2 }));
  }
  return pools.get(key);
}

function query(store, text, params) {
  return poolFor(store).query(text, params);
}

/* Run fn(client) inside a transaction on the store's database. */
async function withTx(store, fn) {
  const client = await poolFor(store).connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

async function closeAll() {
  for (const pool of pools.values()) {
    await pool.end().catch(() => {});
  }
  pools.clear();
}

module.exports = { poolFor, adminPool, query, withTx, closeAll };
