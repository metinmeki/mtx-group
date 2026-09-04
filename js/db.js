/* =====================================================================
   MTX GROUP — Offline database layer (IndexedDB)

   A tiny promise-based wrapper. All business data is stored 100% locally
   so the POS keeps working with no internet connection.

   MULTI-STORE: the database NAME comes from the active tenant, so Melora
   and Bangeen Crystal each get a physically separate database
   (mtx_melora / mtx_bangeen). Nothing is shared — not products, not
   sales, not staff accounts, not settings. Switching store calls close()
   and the next query opens the other database.

   SYNC (optional): when a server is configured (see js/sync.js), every
   local write is also recorded in the `_outbox` store so it can be pushed
   to the server, and `_syncmeta` holds per-store sync cursors and the
   offline-login PIN cache. With no server configured these two stores
   stay empty and nothing else changes — the app is exactly as offline as
   it always was.
   ===================================================================== */
const DB = (() => {
  const VERSION = 2;
  /* Business data — the only stores that get exported, wiped or restored. */
  const STORES = [
    'products', 'categories', 'sales', 'customers', 'suppliers',
    'expenses', 'stockMoves', 'users', 'purchases', 'payments', 'settings', 'logs'
  ];
  /* Sync bookkeeping — never exported, never part of a backup or reset. */
  const SYNC_STORES = ['_outbox', '_syncmeta'];

  let _db = null;
  let _name = null;

  /* While true, writes come from applying a pull from the server, so they
     must NOT be re-queued back into the outbox. */
  let _applyingRemote = false;
  /* serverTime − Date.now() at the last contact, so every write is stamped
     with a clock all terminals agree on. Set by js/sync.js. */
  let _skew = 0;

  const syncEnabled = () => {
    try { return !!(window.Sync && window.Sync.configured && window.Sync.configured()); }
    catch (e) { return false; }
  };
  const pkOf = (store, val) => (store === 'settings' ? val && val.key : val && val.id);

  function open() {
    return new Promise((resolve, reject) => {
      const name = window.Tenant ? Tenant.dbName() : 'mtx_none';
      // A different shop is active than the one we hold open — drop it first.
      if (_db && _name !== name) { try { _db.close(); } catch (e) { /* already gone */ } _db = null; }
      if (_db) return resolve(_db);
      const req = indexedDB.open(name, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        [...STORES, ...SYNC_STORES].forEach((s) => {
          if (!db.objectStoreNames.contains(s)) {
            const key = (s === 'settings' || s === '_outbox' || s === '_syncmeta') ? 'key' : 'id';
            db.createObjectStore(s, { keyPath: key });
          }
        });
      };
      req.onsuccess = () => { _db = req.result; _name = name; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  /* Record one pending change for the server. Deduped by store+id, so a
     record edited ten times before the next sync pushes only once (its
     current state is read live at push time). */
  async function enqueue(store, id, op) {
    if (id == null || SYNC_STORES.includes(store)) return;
    const os = await tx('_outbox', 'readwrite');
    os.put({ key: store + ':' + id, store, id: String(id), op, mtime: api.now() });
  }
  function notifyWrite() {
    try { window.Sync && window.Sync.nudge && window.Sync.nudge(); } catch (e) { /* ignore */ }
  }

  const api = {
    /* Release the handle so the next call opens whichever shop is now active. */
    close() {
      if (_db) { try { _db.close(); } catch (e) { /* already gone */ } }
      _db = null; _name = null;
    },
    /* The database the next query will use — not just the one held open, so
       this stays truthful in the gap between a store switch and the first
       query that reopens the handle. */
    name: () => _name || (window.Tenant ? Tenant.dbName() : null),

    /* ---- sync plumbing (used by js/sync.js) ---- */
    setClockSkew(ms) { _skew = Number(ms) || 0; },
    now() { return Date.now() + _skew; },
    /* Run fn while suppressing outbox recording — for applying pulled changes. */
    async applyRemote(fn) {
      const prev = _applyingRemote;
      _applyingRemote = true;
      try { return await fn(); }
      finally { _applyingRemote = prev; }
    },
    async outbox() { return api.all('_outbox'); },
    async outboxCount() {
      const os = await tx('_outbox');
      return new Promise((res) => { const r = os.count(); r.onsuccess = () => res(r.result || 0); r.onerror = () => res(0); });
    },
    async outboxDelete(key) { return api.del('_outbox', key); },
    async outboxClear() { return api.clear('_outbox'); },
    /* Queue every current record of a store (or all business stores) for
       upload — used once when first connecting an install that already has
       local data. */
    async enqueueAll(store) {
      const list = store ? [store] : STORES;
      for (const s of list) {
        const rows = await api.all(s);
        const osb = await tx('_outbox', 'readwrite');
        const t = api.now();
        rows.forEach((v) => {
          const id = pkOf(s, v);
          if (id != null) osb.put({ key: s + ':' + id, store: s, id: String(id), op: 'put', mtime: t });
        });
      }
    },
    /* key/value bag for sync cursors, tokens-adjacent metadata, PIN cache. */
    async meta(key, value) {
      if (value === undefined) {
        const r = await api.get('_syncmeta', key); return r ? r.value : undefined;
      }
      return (await tx('_syncmeta', 'readwrite')).put({ key, value });
    },
    async metaDelete(key) { return api.del('_syncmeta', key); },

    /* ---- record CRUD ---- */
    async put(store, val) {
      const os = await tx(store, 'readwrite');
      const saved = await new Promise((res, rej) => {
        const r = os.put(val); r.onsuccess = () => res(val); r.onerror = () => rej(r.error);
      });
      if (!_applyingRemote && syncEnabled() && !SYNC_STORES.includes(store)) {
        await enqueue(store, pkOf(store, val), 'put');
        notifyWrite();
      }
      return saved;
    },
    async bulk(store, arr) {
      const db = await open();
      await new Promise((res, rej) => {
        const t = db.transaction(store, 'readwrite');
        arr.forEach((v) => t.objectStore(store).put(v));
        t.oncomplete = () => res(true); t.onerror = () => rej(t.error);
      });
      if (!_applyingRemote && syncEnabled() && !SYNC_STORES.includes(store)) {
        const osb = await tx('_outbox', 'readwrite');
        const now = api.now();
        arr.forEach((v) => {
          const id = pkOf(store, v);
          if (id != null) osb.put({ key: store + ':' + id, store, id: String(id), op: 'put', mtime: now });
        });
        notifyWrite();
      }
      return true;
    },
    async get(store, id) {
      const os = await tx(store);
      return new Promise((res, rej) => {
        const r = os.get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async all(store) {
      const os = await tx(store);
      return new Promise((res, rej) => {
        const r = os.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
      });
    },
    async del(store, id) {
      const os = await tx(store, 'readwrite');
      await new Promise((res, rej) => {
        const r = os.delete(id); r.onsuccess = () => res(true); r.onerror = () => rej(r.error);
      });
      if (!_applyingRemote && syncEnabled() && !SYNC_STORES.includes(store)) {
        await enqueue(store, id, 'del');
        notifyWrite();
      }
      return true;
    },
    async clear(store) {
      const os = await tx(store, 'readwrite');
      return new Promise((res, rej) => {
        const r = os.clear(); r.onsuccess = () => res(true); r.onerror = () => rej(r.error);
      });
    },
    // Settings helpers (key/value) — go through put(), so they queue for sync too.
    async setting(key, val) {
      if (val === undefined) {
        const r = await api.get('settings', key); return r ? r.value : undefined;
      }
      return api.put('settings', { key, value: val });
    },
    // Full backup / restore — stamped with the shop it came from so a backup
    // can't be restored into the wrong store by accident. Sync stores are
    // deliberately excluded.
    async exportAll() {
      const t = window.Tenant ? Tenant.get() : null;
      const out = {
        meta: { app: 'MTX Group POS', store: t ? t.id : null, storeName: t ? t.name : '', version: VERSION, exportedAt: Date.now() },
        data: {}
      };
      for (const s of STORES) out.data[s] = await api.all(s);
      return out;
    },
    async importAll(json) {
      for (const s of STORES) {
        if (!json.data[s]) continue;
        await api.clear(s);
        await api.bulk(s, json.data[s]);
      }
      return true;
    },
    async wipe() { for (const s of [...STORES, ...SYNC_STORES]) await api.clear(s); return true; },

    /* ---------------- Whole-system backup ----------------
       One file covering EVERY store, not just the one you're signed into.
       Restoring it puts the whole install back exactly as it was when the
       file was made — products, sales, invoices, customers, suppliers,
       expenses, stock movements, staff and settings, for every shop.

       The dashboard and reports are not stored separately: they are computed
       from sales, products and expenses, so backing those up backs them up.

       Each shop lives in its own database, so this walks the stores one at a
       time and always returns to the one you started on, even on error. */
    async exportSystem(onProgress) {
      if (!window.Tenant) throw new Error('No stores registered');
      const started = Tenant.id;
      const out = {
        meta: {
          app: 'MTX Group Retail Suite', kind: 'system', version: VERSION,
          exportedAt: Date.now(), stores: STORES_REG().map((s) => s.id),
        },
        stores: {},
      };
      try {
        for (const s of STORES_REG()) {
          if (onProgress) onProgress(s.name);
          await Tenant.set(s.id);
          const one = {};
          for (const st of STORES) one[st] = await api.all(st);
          out.stores[s.id] = { name: s.name, data: one };
        }
      } finally {
        if (started) await Tenant.set(started);
      }
      return out;
    },

    /* Restore a whole-system file. Every shop in the file is wiped and
       rewritten, so the install lands exactly on the snapshot — anything
       recorded since is gone. Shops in the file that this build doesn't
       know about are skipped and reported back. */
    async importSystem(json, onProgress) {
      if (!json || json.meta?.kind !== 'system' || !json.stores) {
        throw new Error('That is not a whole-system backup file');
      }
      const started = Tenant.id;
      const done = [], skipped = [];
      try {
        for (const [id, block] of Object.entries(json.stores)) {
          if (!Tenant.find(id)) { skipped.push(id); continue; }
          if (onProgress) onProgress(block.name || id);
          await Tenant.set(id);
          await api.wipe();
          const data = block.data || block;
          for (const st of STORES) if (data[st]) await api.bulk(st, data[st]);
          done.push(block.name || id);
        }
      } finally {
        if (started) await Tenant.set(started);
      }
      return { done, skipped };
    },

    stores: STORES
  };
  /* Read lazily: js/stores.js loads after this file. */
  const STORES_REG = () => (window.STORES || []);
  return api;
})();
window.DB = DB;
