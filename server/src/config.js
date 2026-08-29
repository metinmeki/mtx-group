'use strict';
/* Central configuration. Everything comes from environment variables (see
   .env.example); this module just parses, validates and applies defaults. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseDatabaseUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || null,
      port: u.port ? Number(u.port) : null,
      user: u.username ? decodeURIComponent(u.username) : null,
      password: u.password ? decodeURIComponent(u.password) : null,
      ssl: u.searchParams.get('sslmode') === 'require' || u.searchParams.get('ssl') === 'true',
    };
  } catch {
    return {};
  }
}

const fromUrl = process.env.DATABASE_URL ? parseDatabaseUrl(process.env.DATABASE_URL) : {};

const stores = String(process.env.STORES || 'melora,bangeen')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const dbPrefix = process.env.DB_PREFIX || 'mtx_';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5599,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  serveStatic: process.env.SERVE_STATIC || null,

  stores,
  dbPrefix,
  /* One physically separate database per store — never a shared one. */
  dbNameFor(store) {
    if (!stores.includes(store)) throw new Error(`Unknown store: ${store}`);
    return dbPrefix + store;
  },

  pg: {
    host: process.env.PGHOST || fromUrl.host || '127.0.0.1',
    port: Number(process.env.PGPORT) || fromUrl.port || 5432,
    user: process.env.PGUSER || fromUrl.user || 'postgres',
    password: process.env.PGPASSWORD || fromUrl.password || '',
    ssl: process.env.PGSSL === 'true' || fromUrl.ssl || false,
    adminDatabase: process.env.PGADMIN_DB || 'postgres',
  },

  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  defaultAdminPin: process.env.DEFAULT_ADMIN_PIN || '1234',
};

/* Fail fast on an obviously-broken production config. */
function assertProductionReady() {
  const problems = [];
  if (config.env === 'production') {
    if (!config.jwt.secret || config.jwt.secret.length < 24) problems.push('JWT_SECRET must be set to a long random string');
    if (config.corsOrigin === '*') problems.push('CORS_ORIGIN should be your app domain, not *');
  }
  if (!config.stores.length) problems.push('STORES is empty');
  return problems;
}

module.exports = config;
module.exports.assertProductionReady = assertProductionReady;
