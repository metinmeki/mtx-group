'use strict';
/* User records are special: the PIN is stored only as a bcrypt hash and never
   leaves the server, so users don't go through the generic sync path. The app
   reads the list (names + roles, for the login screen and Users & Roles page)
   and Admins create/update them through dedicated endpoints. */
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

function newId() {
  return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function list(store) {
  const { rows } = await db.query(
    store,
    `SELECT id, name, role, email, active, seq
       FROM users
      WHERE deleted = false
      ORDER BY name`,
  );
  return rows;
}

async function create(store, body) {
  const { name, role, pin, email } = body || {};
  if (!name || pin == null || pin === '') {
    const e = new Error('name and pin are required'); e.status = 400; throw e;
  }
  const id = body.id || newId();
  const hash = bcrypt.hashSync(String(pin), config.bcryptRounds);
  await db.query(
    store,
    `INSERT INTO users (id, name, role, email, active, pin_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, name, role || 'Cashier', email || null, body.active !== false, hash],
  );
  return { id };
}

async function update(store, id, patch) {
  patch = patch || {};
  const sets = [];
  const vals = [];
  const put = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if (patch.name !== undefined) put('name', patch.name);
  if (patch.role !== undefined) put('role', patch.role);
  if (patch.email !== undefined) put('email', patch.email || null);
  if (patch.active !== undefined) put('active', !!patch.active);
  if (patch.deleted !== undefined) put('deleted', !!patch.deleted);
  if (patch.pin) put('pin_hash', bcrypt.hashSync(String(patch.pin), config.bcryptRounds));

  if (!sets.length) return { updated: 0 };
  // bump the change counter so the update reaches other terminals via sync
  sets.push("seq = nextval('change_seq')", 'updated_at = now()');
  vals.push(String(id));
  const { rowCount } = await db.query(
    store,
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`,
    vals,
  );
  return { updated: rowCount };
}

module.exports = { list, create, update };
