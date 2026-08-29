'use strict';
/* Authentication: a cashier picks their name on the login screen and enters a
   PIN. The PIN is checked (bcrypt) against that store's `users` table and a
   short-lived JWT is issued. Every later request carries `Authorization:
   Bearer <token>`; the token is bound to one store, so a Melora token can
   never touch Bangeen's database. */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

function signToken(user, store) {
  return jwt.sign(
    { sub: user.id, name: user.name, role: user.role, store },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

async function login({ store, userId, pin }) {
  if (!config.stores.includes(store)) {
    const e = new Error('Unknown store'); e.status = 404; throw e;
  }
  if (!userId || pin == null || pin === '') {
    const e = new Error('userId and pin are required'); e.status = 400; throw e;
  }
  const { rows } = await db.query(
    store,
    'SELECT id, name, role, active, pin_hash FROM users WHERE id = $1 AND deleted = false',
    [String(userId)],
  );
  const user = rows[0];
  const ok = user && user.active && bcrypt.compareSync(String(pin), user.pin_hash);
  if (!ok) {
    const e = new Error('Incorrect user or PIN'); e.status = 401; throw e;
  }
  return {
    token: signToken(user, store),
    user: { id: user.id, name: user.name, role: user.role },
    store,
    serverTime: Date.now(),
  };
}

/* Express middleware — verifies the token and attaches req.auth + req.store. */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const claims = jwt.verify(token, config.jwt.secret);
    if (!config.stores.includes(claims.store)) return res.status(401).json({ error: 'Token store no longer exists' });
    req.auth = claims;
    req.store = claims.store;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Your role cannot do that' });
    }
    next();
  };
}

module.exports = { login, authMiddleware, requireRole, signToken };
