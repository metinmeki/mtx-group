'use strict';
/* The single source of truth for what data exists.

   Every store in the browser app's IndexedDB (see js/db.js `STORES`) maps to
   one PostgreSQL table here. This one list drives three things:
     - schema.js       creates the tables
     - sync.js         builds the pull change-feed and validates pushes
     - import.js       loads a Backup & Restore export

   `users` is deliberately NOT in this list — it needs real auth columns and
   PIN hashing, so it is handled on its own everywhere. */

const SYNC_TABLES = [
  { store: 'categories', sql: 'categories' },
  { store: 'products', sql: 'products' },
  { store: 'customers', sql: 'customers' },
  { store: 'suppliers', sql: 'suppliers' },
  { store: 'sales', sql: 'sales' },
  { store: 'expenses', sql: 'expenses' },
  { store: 'stockMoves', sql: 'stock_moves' },
  { store: 'purchases', sql: 'purchases' },
  { store: 'payments', sql: 'payments' },
  { store: 'logs', sql: 'logs' },
  { store: 'settings', sql: 'settings', key: 'key' },
];

const BY_STORE = Object.fromEntries(SYNC_TABLES.map((t) => [t.store, t]));

/* settings keys a client push must never write to the server.
   - invoiceSeq: the invoice-number counter. Each terminal keeps its own local
     counter; a stale offline client pushing it backwards would hand out
     duplicate invoice numbers. (Phase 3 replaces it with per-terminal prefixes.)
   - seeded: a purely local first-run flag, meaningless on the server.
   Everything else in `settings` — store info, currency, receipt footer, role
   access overrides — syncs normally so every terminal agrees. */
const PROTECTED_SETTINGS = new Set(['invoiceSeq', 'seeded']);

module.exports = { SYNC_TABLES, BY_STORE, PROTECTED_SETTINGS };
