/* =====================================================================
   MTX GROUP — First-run bootstrap (per store)

   Runs against whichever store is currently open, so each shop bootstraps
   its own database independently: Melora's first launch does not touch
   Bangeen Crystal and vice versa.

   A fresh store starts EMPTY: no products, categories, sales, expenses,
   customers or suppliers. Only the bare minimum needed to sign in and sell
   is created. Sample data is available on demand via Seed.demo().
   ===================================================================== */
const Seed = (() => {

  /* Store-appropriate sample catalogues, keyed by tenant id. Used only by
     demo() — never by run(). */
  const DEMO = {
    melora: {
      currency: 'USD',
      footer: 'Thank you for choosing Melora ♥',
      cats: [
        { id: 'c1', name: 'Skincare', icon: '🧴' },
        { id: 'c2', name: 'Makeup', icon: '💄' },
        { id: 'c3', name: 'Fragrance', icon: '🌸' },
        { id: 'c4', name: 'Hair Care', icon: '💇' },
        { id: 'c5', name: 'Body & Bath', icon: '🛁' },
        { id: 'c6', name: 'Accessories', icon: '👜' }
      ],
      /* name, category, cost, price, stock, icon */
      items: [
        ['Hydrating Face Serum 30ml', 'c1', 6.50, 15.00, 40, '🧴'],
        ['Vitamin C Brightening Cream', 'c1', 7.20, 17.50, 28, '🧴'],
        ['Micellar Cleansing Water 400ml', 'c1', 3.10, 7.50, 60, '🧴'],
        ['Clay Purifying Mask', 'c1', 4.00, 9.90, 22, '🧖'],
        ['Sunscreen SPF50 50ml', 'c1', 5.40, 12.90, 35, '☀️'],
        ['Matte Liquid Lipstick', 'c2', 2.80, 8.50, 90, '💄'],
        ['Velvet Foundation 30ml', 'c2', 6.90, 16.00, 44, '💄'],
        ['Eyeshadow Palette 12 Shades', 'c2', 8.50, 21.00, 18, '🎨'],
        ['Volume Mascara', 'c2', 3.20, 9.00, 55, '👁'],
        ['Gel Eyeliner Pen', 'c2', 2.10, 6.50, 70, '✏️'],
        ['Rose Bloom EDP 50ml', 'c3', 14.00, 34.00, 16, '🌸'],
        ['Oud Nuit EDP 100ml', 'c3', 22.00, 52.00, 9, '🌙'],
        ['Body Mist Vanilla 250ml', 'c3', 3.60, 9.50, 48, '🌼'],
        ['Argan Repair Shampoo 400ml', 'c4', 4.20, 10.50, 38, '💇'],
        ['Keratin Hair Mask 250ml', 'c4', 5.10, 13.00, 24, '💆'],
        ['Heat Protection Spray', 'c4', 3.90, 10.00, 30, '🔥'],
        ['Shea Body Butter 200ml', 'c5', 4.40, 11.00, 33, '🧈'],
        ['Rose Bath Salt 500g', 'c5', 3.00, 8.00, 41, '🛁'],
        ['Exfoliating Body Scrub', 'c5', 3.70, 9.50, 27, '🧽'],
        ['Makeup Brush Set 8pc', 'c6', 6.00, 15.50, 20, '🖌'],
        ['Cosmetic Pouch', 'c6', 2.50, 7.00, 36, '👜'],
        ['Beauty Blender Sponge', 'c6', 1.10, 3.50, 80, '🥚']
      ],
      suppliers: [
        { id: 's1', name: 'Aurora Beauty Supply', company: 'Aurora Cosmetics Ltd.', phone: '+964 770 111 2233', debt: 980.00, products: 'Skincare, Makeup' },
        { id: 's2', name: 'Levant Fragrance House', company: 'Levant Perfumes', phone: '+964 750 445 6677', debt: 0, products: 'Fragrance' },
        { id: 's3', name: 'GlowLine Distribution', company: 'GlowLine LLC', phone: '+964 751 998 1020', debt: 410.00, products: 'Hair Care, Body & Bath' }
      ],
      customers: [
        { id: 'cu2', name: 'Lana Hussein', phone: '+964 770 555 1234', debt: 32.00, points: 280, address: 'Erbil, 60m St.' },
        { id: 'cu3', name: 'Shene Ali', phone: '+964 750 222 8899', debt: 0, points: 150, address: 'Sulaymaniyah' },
        { id: 'cu4', name: 'Vian Salon', phone: '+964 751 333 4455', debt: 265.00, points: 1100, address: 'Duhok Center' }
      ],
      users: [
        { id: 'u2', name: 'Dilan M.', role: 'Manager', pin: '2222', active: true, email: 'dilan@melora.shop' },
        { id: 'u3', name: 'Roj K.', role: 'Cashier', pin: '3333', active: true, email: 'roj@melora.shop' },
        { id: 'u4', name: 'Hemn A.', role: 'Accountant', pin: '4444', active: true, email: 'hemn@melora.shop' }
      ]
    },

    bangeen: {
      currency: 'USD',
      footer: 'Thank you — Bangeen Crystal',
      cats: [
        { id: 'c1', name: 'Chandeliers', icon: '💡' },
        { id: 'c2', name: 'Glassware', icon: '🥂' },
        { id: 'c3', name: 'Vases', icon: '🏺' },
        { id: 'c4', name: 'Tableware', icon: '🍽' },
        { id: 'c5', name: 'Gift Sets', icon: '🎁' },
        { id: 'c6', name: 'Home Decor', icon: '🕯' }
      ],
      items: [
        ['Crystal Chandelier 6-Arm', 'c1', 210.00, 470.00, 6, '💡'],
        ['Crystal Chandelier 12-Arm', 'c1', 430.00, 920.00, 3, '💡'],
        ['Pendant Crystal Lamp', 'c1', 78.00, 165.00, 11, '🔆'],
        ['Wall Sconce Pair', 'c1', 55.00, 120.00, 14, '🕯'],
        ['Crystal Wine Glass Set 6', 'c2', 26.00, 58.00, 30, '🍷'],
        ['Champagne Flute Set 6', 'c2', 24.00, 54.00, 22, '🥂'],
        ['Whisky Tumbler Set 6', 'c2', 28.00, 62.00, 25, '🥃'],
        ['Water Glass Set 12', 'c2', 30.00, 68.00, 18, '💧'],
        ['Cut Crystal Vase 30cm', 'c3', 34.00, 78.00, 16, '🏺'],
        ['Tall Crystal Vase 45cm', 'c3', 52.00, 115.00, 9, '🏺'],
        ['Rose Bowl Vase', 'c3', 19.00, 44.00, 21, '🌹'],
        ['Crystal Dinner Set 24pc', 'c4', 145.00, 320.00, 7, '🍽'],
        ['Serving Platter Large', 'c4', 27.00, 62.00, 15, '🍛'],
        ['Crystal Fruit Bowl', 'c4', 22.00, 50.00, 20, '🍇'],
        ['Tea Glass Set 12 (Gold Rim)', 'c4', 33.00, 74.00, 26, '🫖'],
        ['Wedding Gift Set — Deluxe', 'c5', 96.00, 210.00, 8, '🎁'],
        ['Crystal Photo Frame', 'c5', 12.00, 29.00, 34, '🖼'],
        ['Engraved Award Trophy', 'c5', 30.00, 72.00, 12, '🏆'],
        ['Crystal Candle Holder Pair', 'c6', 17.00, 40.00, 28, '🕯'],
        ['Decorative Crystal Ball', 'c6', 9.50, 24.00, 40, '🔮'],
        ['Mirror Tray 40cm', 'c6', 21.00, 49.00, 17, '🪞']
      ],
      suppliers: [
        { id: 's1', name: 'Bohemia Crystal Import', company: 'Bohemia Trading', phone: '+964 770 111 2233', debt: 3450.00, products: 'Chandeliers, Glassware' },
        { id: 's2', name: 'Gulf Glass Partners', company: 'Gulf Glass LLC', phone: '+964 750 445 6677', debt: 0, products: 'Vases, Tableware' },
        { id: 's3', name: 'Anatolia Giftware', company: 'Anatolia Ltd.', phone: '+964 751 998 1020', debt: 720.00, products: 'Gift Sets, Decor' }
      ],
      customers: [
        { id: 'cu2', name: 'Karwan Ahmed', phone: '+964 770 555 1234', debt: 320.00, points: 410, address: 'Erbil, 100m St.' },
        { id: 'cu3', name: 'Nishtiman Events', phone: '+964 750 222 8899', debt: 0, points: 260, address: 'Sulaymaniyah' },
        { id: 'cu4', name: 'Zagros Hotel', phone: '+964 751 333 4455', debt: 1450.00, points: 2200, address: 'Duhok Center' }
      ],
      users: [
        { id: 'u2', name: 'Aland S.', role: 'Manager', pin: '2222', active: true, email: 'aland@bangeen.shop' },
        { id: 'u3', name: 'Bawan H.', role: 'Cashier', pin: '3333', active: true, email: 'bawan@bangeen.shop' },
        { id: 'u4', name: 'Sazan R.', role: 'Accountant', pin: '4444', active: true, email: 'sazan@bangeen.shop' }
      ]
    }
  };

  const tenant = () => (window.Tenant && Tenant.get()) || null;
  const profile = () => DEMO[tenant() ? tenant().id : ''] || DEMO.melora;

  /* Runs once the first time a store is opened (and again after that store's
     "Reset All Data"). Scoped entirely to the active store's database. */
  async function run() {
    const done = await DB.setting('seeded');
    if (done) return;
    const t = tenant();

    // One administrator so you can sign in — rename it or add your team in Users & Roles.
    await DB.bulk('users', [
      { id: 'u1', name: 'Owner Admin', role: 'Super Admin', pin: '1234', active: true, email: '' }
    ]);

    // The POS falls back to this customer for quick sales, so it must exist.
    await DB.bulk('customers', [
      { id: 'cu1', name: 'Walk-in Customer', phone: '', debt: 0, points: 0, address: '' }
    ]);

    await DB.setting('store', {
      name: t ? t.legal : 'My Store', phone: '', address: '',
      currency: 'USD', tax: 0, footer: t ? 'Thank you — ' + t.name : 'Thank you!', logo: t ? t.logo : ''
    });
    await DB.setting('currency', 'USD');
    await DB.setting('fxRate', 1320);
    await DB.setting('drawer', { opening: 0, ts: Date.now() });
    await DB.setting('seeded', true);
    console.log('[MTX] Empty system ready for', t ? t.name : 'store');
  }

  /* Optional sample catalogue + 14 days of trading history, for trying the
     system out. Never runs automatically — only from Backup → Load demo data.
     The catalogue matches the store you're in (cosmetics vs. crystal). */
  async function demo() {
    const t = tenant();
    const p = profile();

    await DB.bulk('categories', p.cats);

    // deterministic, valid EAN-13 (in-store "20" prefix + check digit)
    const ean = (seq) => {
      const d = ('20' + String(1000000000 + seq * 137)).slice(0, 12);
      let s = 0; for (let k = 0; k < 12; k++) s += (+d[k]) * (k % 2 === 0 ? 1 : 3);
      return d + String((10 - (s % 10)) % 10);
    };
    const products = p.items.map((n, i) => ({
      id: 'p' + (i + 1), name: n[0], category: n[1], cost: n[2], price: n[3],
      wholesale: +(n[3] * 0.85).toFixed(2), stock: n[4], minStock: 5, barcode: ean(i),
      sku: 'SKU-' + String(1000 + i), unit: 'pcs', supplier: 's' + ((i % 3) + 1), active: true,
      icon: n[5], expiry: null
    }));
    await DB.bulk('products', products);
    await DB.bulk('suppliers', p.suppliers);
    await DB.bulk('customers', [
      { id: 'cu1', name: 'Walk-in Customer', phone: '', debt: 0, points: 0, address: '' },
      ...p.customers
    ]);
    await DB.bulk('users', [
      { id: 'u1', name: 'Owner Admin', role: 'Super Admin', pin: '1234', active: true, email: '' },
      ...p.users
    ]);

    // ~14 days of trading history
    const sales = []; const cashiers = [...p.users.map((u) => u.name), 'Owner Admin'];
    const pays = ['Cash', 'Card', 'Cash', 'Split', 'Cash'];
    for (let d = 13; d >= 0; d--) {
      const count = 6 + Math.floor(Math.random() * 7);
      for (let k = 0; k < count; k++) {
        const items = []; const n = 1 + Math.floor(Math.random() * 4); let sub = 0, cost = 0;
        for (let j = 0; j < n; j++) {
          const pr = products[Math.floor(Math.random() * products.length)];
          const q = 1 + Math.floor(Math.random() * 3);
          items.push({ id: pr.id, name: pr.name, price: pr.price, qty: q, cost: pr.cost });
          sub += pr.price * q; cost += pr.cost * q;
        }
        const disc = Math.random() < 0.25 ? +(sub * 0.05).toFixed(2) : 0;
        const total = +(sub - disc).toFixed(2);
        // business hours only, never in the future
        const day = new Date(); day.setDate(day.getDate() - d); day.setHours(9, 0, 0, 0);
        let ts = day.getTime() + Math.floor(Math.random() * 11 * 3600000);
        if (ts > Date.now()) ts = Date.now() - Math.floor(Math.random() * 3600000);
        sales.push({
          id: UI.uid('inv'), no: 0, ts, items, subtotal: +sub.toFixed(2), discount: disc, tax: 0,
          total, cost: +cost.toFixed(2), profit: +(total - cost).toFixed(2),
          pay: pays[Math.floor(Math.random() * pays.length)], cashier: cashiers[Math.floor(Math.random() * cashiers.length)],
          customer: 'Walk-in Customer', status: 'completed', type: 'sale'
        });
      }
    }
    sales.sort((a, b) => a.ts - b.ts).forEach((s, i) => s.no = 1001 + i);
    await DB.bulk('sales', sales);

    const exCats = ['Rent', 'Utilities', 'Salaries', 'Maintenance', 'Delivery', 'Supplies'];
    const expenses = [];
    for (let d = 12; d >= 0; d -= 3) {
      const c = exCats[Math.floor(Math.random() * exCats.length)];
      expenses.push({
        id: UI.uid('exp'), ts: Date.now() - d * 86400000, category: c, amount: +(15 + Math.random() * 95).toFixed(2),
        pay: 'Cash', note: c + ' expense', recurring: c === 'Rent'
      });
    }
    await DB.bulk('expenses', expenses);

    await DB.setting('store', {
      name: t ? t.legal : 'My Store', phone: '+964 770 000 1122', address: 'Main Street, City Center',
      currency: p.currency, tax: 0, footer: p.footer, logo: t ? t.logo : ''
    });
    await DB.setting('drawer', { opening: 200, ts: Date.now() });
    await DB.setting('seeded', true);
    console.log('[MTX] Demo data loaded for', t ? t.name : 'store');
  }

  return { run, demo };
})();
window.Seed = Seed;
