# MTX Group — Retail Suite

An offline-first Point of Sale and business-management system that runs **two
completely independent stores from one install**:

| Store | Trade | Database | Accent |
|---|---|---|---|
| **Melora** | Beauty & Cosmetics | `mtx_melora` | Plum `#7A2E58` |
| **Bangeen Crystal** | Crystal & Glassware | `mtx_bangeen` | Antique gold `#A87D2E` |

The first screen is the **store picker**. You click a logo, and from that
moment every query in the app is pointed at that store's own database.

---

## The one rule: nothing is shared

Each store gets its own IndexedDB database. Not a filtered view, not a
`storeId` column — a physically separate database. That means each store has
its own:

- products, categories, barcodes and stock levels
- sales, invoices, receipts and refunds
- customers, suppliers and their debts
- expenses, cash drawer and financial reports
- **staff accounts, PINs and role permissions**
- store name, address, phone, receipt footer, currency and exchange rate

Signing into Melora gives you no way to read or write Bangeen's books, and
vice versa. Backups are per store and stamped with their origin, so restoring
a Melora backup while signed into Bangeen warns you loudly before it can
overwrite anything.

What *is* shared: the software itself, and two device-level preferences —
**language** (English / العربية) and **light/dark theme**. Those follow the
person at the till, not the shop.

---

## Running it

**As a web app** (also how the kiosk launcher runs it):

```bash
npm run serve
```

Then open <http://127.0.0.1:5588/>. Localhost counts as a secure context, so
the service worker registers and the app works fully offline after first load.

**As a desktop app:**

```bash
npm start
```

**Build a Windows installer:**

```bash
npm run dist
```

---

## First run

Each store starts **empty** — no products, no sales, no customers. The only
thing created is one administrator so you can get in:

- **User:** Owner Admin
- **PIN:** `1234`

Change that PIN in *Users & Roles* before going live, then add your team.

To try the system out with a realistic catalogue and two weeks of trading
history, go to *Backup & Restore → Sample data → Load demo data*. The demo
catalogue matches the store you're in — cosmetics for Melora, crystal and
glassware for Bangeen. Loading demo data into one store does not touch the
other.

---

## Architecture

```
index.html          splash → picker → per-store login → app shell
js/stores.js        the store registry — id, database, logo, accent palette
js/db.js            IndexedDB wrapper; database NAME comes from the tenant
js/app.js           Store analytics, router, chrome, auth, store switching
js/seed.js          per-store bootstrap + per-store demo catalogue
js/ui.js            formatting, toasts, modals, charts
js/i18n.js          Arabic translation layer (English is the source of truth)
js/xlsx.js          dependency-free XLSX read/write
js/views-core.js    Dashboard, POS Checkout, Products
js/views-ops.js     Inventory, Barcode, Expenses, Customers, Suppliers
js/views-finance.js Financial Center, Reports, Invoices & Receipts
js/views-admin.js   Users & Permissions, Settings, Backup/Restore, Offline
css/styles.css      design system — neutral shell, accent injected per store
electron/           desktop shell (serves the PWA from 127.0.0.1)
service-worker.js   offline app-shell cache
```

### How per-store theming works

`css/styles.css` defines a warm, store-neutral shell (charcoal, sand, stone)
and reads its accent from `--primary`, `--primary-2`, `--accent`,
`--brand-grad` and friends. `Tenant.paint()` writes those custom properties
onto `:root` from the active store's entry in `js/stores.js`. One stylesheet,
two identities — and the accent swaps again between light and dark so the
plum and the gold stay legible on both grounds.

### Works on every device

The owner reads his reports on a phone, so every module — not just the POS —
is built to survive a 320px screen. Verified clean (no horizontal overflow,
top bar fits, nothing clipped) at **320, 375, 390, 768, 1024 and 1280px**, in
both portrait and landscape, in English and Arabic RTL.

What changes as the screen narrows:

| Width | Behaviour |
|---|---|
| ≥ 1100px | Full layout — fixed sidebar, multi-column grids, 4 KPI tiles across |
| ≤ 1100px | KPIs go 2-across; the POS stacks and the cart becomes a full-screen overlay |
| ≤ 860px | Sidebar becomes a drawer; **all** grids collapse to one column; the top bar keeps only menu / page / store / ＋Sale and moves theme, language, switch-store and sign-out into the drawer; the login panel grows its own logo + back link |
| ≤ 560px | Tighter padding, larger tap targets (40px minimum), condensed tables |
| ≤ 400px | Top bar condenses — the **store name is never dropped**; the page title yields space instead |

Three details worth knowing:

- **Tables scroll, they don't clip.** Grid and flex children default to
  `min-width: auto`, which made a wide table stretch its card past the screen
  edge where `overflow: hidden` cut the far columns off. Letting those boxes
  shrink (`min-width: 0`) is what hands the overflow to `.table-wrap` so it
  can scroll horizontally.
- **Charts are rebuilt for small screens, not shrunk.** An SVG `viewBox`
  scales its contents, so the desktop chart's 10pt labels rendered at about
  5px on a phone. Narrow screens get their own taller, coarser geometry
  (larger labels, thicker strokes) instead of a squashed copy.
- **Rotating re-renders.** Because chart geometry is chosen at render time,
  crossing the 560px boundary re-runs the current view.

### Adding a third store

Append an entry to `STORES` in `js/stores.js` with a unique `id`, a `db` name,
a logo path, and its accent palette. Drop the logo in `/assets` and add it to
the `SHELL` list in `service-worker.js`. Nothing else needs to change — the
picker, the login screen, the theming and the database routing all read from
that array.
