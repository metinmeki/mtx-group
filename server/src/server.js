'use strict';
/* The Express app: health, auth, sync, and user management. Kept in its own
   module (no listen()) so tests can mount it without opening a port. */
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const users = require('./users');
const sync = require('./sync');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind nginx/caddy
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '25mb' })); // first full upload can be large

  const tightLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---------- public ---------- */

  app.get('/api/health', wrap(async (req, res) => {
    const out = { ok: true, env: config.env, stores: {} };
    for (const s of config.stores) {
      try {
        const { rows } = await db.query(s, "SELECT value FROM _meta WHERE key = 'schema_version'");
        out.stores[s] = { db: 'ok', schema: rows[0] ? rows[0].value : 'not-migrated' };
      } catch (e) {
        out.ok = false;
        out.stores[s] = { db: 'error', message: e.message };
      }
    }
    res.status(out.ok ? 200 : 503).json(out);
  }));

  app.get('/api/stores', (req, res) => res.json({ stores: config.stores }));

  // Login screen: pick a user, then enter a PIN. Names + roles only, which is
  // exactly what the current app already shows on its login screen.
  app.get('/api/stores/:store/users', tightLimiter, wrap(async (req, res) => {
    if (!config.stores.includes(req.params.store)) return res.status(404).json({ error: 'Unknown store' });
    res.json({ users: await users.list(req.params.store) });
  }));

  app.post('/api/login', tightLimiter, wrap(async (req, res) => {
    res.json(await auth.login(req.body || {}));
  }));

  /* ---------- authenticated ---------- */

  app.use('/api', auth.authMiddleware);

  app.get('/api/me', (req, res) => res.json({
    user: { id: req.auth.sub, name: req.auth.name, role: req.auth.role },
    store: req.auth.store,
  }));

  app.get('/api/sync/pull', wrap(async (req, res) => {
    res.json(await sync.pull(req.store, req.query.since, req.query.limit));
  }));

  app.post('/api/sync/push', wrap(async (req, res) => {
    res.json(await sync.push(req.store, (req.body && req.body.changes) || []));
  }));

  app.get('/api/users', auth.requireRole('Super Admin', 'Admin', 'Manager'), wrap(async (req, res) => {
    res.json({ users: await users.list(req.store) });
  }));
  app.post('/api/users', auth.requireRole('Super Admin', 'Admin'), wrap(async (req, res) => {
    res.status(201).json(await users.create(req.store, req.body || {}));
  }));
  app.patch('/api/users/:id', auth.requireRole('Super Admin', 'Admin'), wrap(async (req, res) => {
    res.json(await users.update(req.store, req.params.id, req.body || {}));
  }));

  /* ---------- optional: serve the app itself ---------- */

  if (config.serveStatic) {
    const dir = path.resolve(__dirname, '..', config.serveStatic);
    app.use(express.static(dir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  /* ---------- errors ---------- */

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server error' });
  });

  return app;
}

module.exports = { createApp };
