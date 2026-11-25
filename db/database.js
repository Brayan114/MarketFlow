const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DEFAULT_DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), 'marketflow.db')
  : path.join(__dirname, '..', 'data', 'marketflow.db');

const SCHEMA_PATH = fs.existsSync(path.join(__dirname, 'schema.sql'))
  ? path.join(__dirname, 'schema.sql')
  : path.join(process.cwd(), 'db', 'schema.sql');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function makeLocalDayTimestamp(daysAgo, hour = 11, minute = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute, 0, 0);
  if (daysAgo === 0 && d > now) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, Math.min(now.getMinutes(), 1), 0, 0).toISOString();
  }
  return d.toISOString();
}

function formatReceiptDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      // Ignore rollback errors if transaction was already aborted
    }
    throw err;
  }
}

function initDatabase(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:' && !process.env.VERCEL) {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');

  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schemaSql);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db) {
  const roleCount = db.prepare('SELECT COUNT(*) AS count FROM roles').get().count;
  if (roleCount > 0) return;

  withTransaction(db, () => {
    const insertRole = db.prepare(
      'INSERT INTO roles (name, display_name, description) VALUES (?, ?, ?)'
    );
    const roles = [
      ['admin', 'System Administrator', 'Full system configuration, user management, and oversight'],
      ['manager', 'Owner / Manager', 'Dashboard, reports, sales oversight, staff management, and inventory'],
      ['cashier', 'Cashier', 'POS checkout, own transaction history, and receipt printing'],
      ['inventory_officer', 'Inventory Officer', 'Product catalogue, stock receiving, adjustments, and suppliers']
    ];
    const roleIds = {};
    for (const [name, displayName, description] of roles) {
      const info = insertRole.run(name, displayName, description);
      roleIds[name] = Number(info.lastInsertRowid);
    }

    const insertUser = db.prepare(
      'INSERT INTO users (full_name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)'
    );
    const seedUsers = [
      ['Adaeze Okonkwo', 'admin@marketflow.local', 'admin123', 'admin'],
      ['David Mensah', 'manager@marketflow.local', 'manager123', 'manager'],
      ['Chidi Eze', 'cashier@marketflow.local', 'cashier123', 'cashier'],
      ['Amina Yusuf', 'inventory@marketflow.local', 'inventory123', 'inventory_officer']
    ];
    const userIds = {};
    for (const [fullName, email, password, roleName] of seedUsers) {
      const hash = bcrypt.hashSync(password, 10);
      const info = insertUser.run(fullName, email, hash, roleIds[roleName], 'active');
      userIds[roleName] = Number(info.lastInsertRowid);
    }

    const insertSetting = db.prepare('INSERT INTO store_settings (key, value) VALUES (?, ?)');
    const defaultSettings = [
      ['store_name', 'MarketFlow Supermarket'],
      ['store_address', '14 Commerce Avenue, Main District'],
      ['store_phone', '+1 (555) 234-5678'],
      ['currency_symbol', '$'],
      ['tax_enabled', 'true'],
      ['tax_rate', '7.5'],
      ['receipt_footer', 'Thank you for shopping at MarketFlow!'],
      ['max_cashier_discount_percent', '10']
    ];
    for (const [key, value] of defaultSettings) {
      insertSetting.run(key, value);
    }

    const insertCategory = db.prepare(
      'INSERT INTO categories (name, description) VALUES (?, ?)'
    );
    const seedCategories = [
      ['Beverages', 'Bottled water, juices, soft drinks, tea and coffee'],
      ['Dairy & Eggs', 'Milk, yoghurt, butter, cheese and fresh eggs'],
      ['Bakery & Grains', 'Bread, rice, pasta, flour and breakfast cereals'],
      ['Produce & Fresh', 'Fresh fruits, vegetables and chilled produce'],
      ['Household & Cleaning', 'Detergents, tissue, dish soap and home essentials'],
      ['Snacks & Pantry', 'Biscuits, cooking oil, sauces, sugar and dry goods']
    ];
    const categoryIds = {};
    for (const [name, desc] of seedCategories) {
      const info = insertCategory.run(name, desc);
      categoryIds[name] = Number(info.lastInsertRowid);
    }

    const insertSupplier = db.prepare(
      'INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)'
    );
    const seedSuppliers = [
      ['FreshFarm Distributors', 'Samuel Bello', '+1 (555) 410-1122', 'orders@freshfarm.example', '22 Valley Road'],
      ['Metro Beverage Wholesale', 'Grace Lin', '+1 (555) 410-3344', 'supply@metrobev.example', '8 Industrial Park'],
      ['PureHome Supplies Ltd', 'Tariq Hassan', '+1 (555) 410-5566', 'sales@purehome.example', '45 Warehouse Way'],
      ['Golden Grain Foods', 'Ngozi Okafor', '+1 (555) 410-7788', 'dispatch@goldengrain.example', '19 Mill Street']
    ];
    const supplierIds = {};
    for (const [name, contact, phone, email, address] of seedSuppliers) {
      const info = insertSupplier.run(name, contact, phone, email, address);
      supplierIds[name] = Number(info.lastInsertRowid);
    }

    // Define target final quantities and historical sales so ledger matches 100%
    const seedProducts = [
      { name: 'Spring Water 750ml', sku: 'BEV-001', barcode: '8901000001', cat: 'Beverages', sell: 1.20, cost: 0.70, unit: 'bottle', reorder: 24, targetQty: 65 },
      { name: 'Orange Juice 1L', sku: 'BEV-002', barcode: '8901000002', cat: 'Beverages', sell: 3.80, cost: 2.40, unit: 'carton', reorder: 15, targetQty: 12 },
      { name: 'Instant Coffee Jar 200g', sku: 'BEV-003', barcode: '8901000003', cat: 'Beverages', sell: 6.50, cost: 4.20, unit: 'jar', reorder: 10, targetQty: 28 },
      { name: 'Whole Fresh Milk 1L', sku: 'DAI-001', barcode: '8901000004', cat: 'Dairy & Eggs', sell: 2.40, cost: 1.60, unit: 'carton', reorder: 20, targetQty: 14 },
      { name: 'Farm Fresh Eggs (12s)', sku: 'DAI-002', barcode: '8901000005', cat: 'Dairy & Eggs', sell: 4.50, cost: 3.10, unit: 'crate', reorder: 15, targetQty: 32 },
      { name: 'Salted Butter 250g', sku: 'DAI-003', barcode: '8901000006', cat: 'Dairy & Eggs', sell: 3.60, cost: 2.30, unit: 'pack', reorder: 12, targetQty: 25 },
      { name: 'Sliced Wheat Bread', sku: 'BAK-001', barcode: '8901000007', cat: 'Bakery & Grains', sell: 2.20, cost: 1.35, unit: 'loaf', reorder: 15, targetQty: 40 },
      { name: 'Long Grain Rice 5kg', sku: 'BAK-002', barcode: '8901000008', cat: 'Bakery & Grains', sell: 11.50, cost: 8.40, unit: 'bag', reorder: 10, targetQty: 22 },
      { name: 'Spaghetti Pasta 500g', sku: 'BAK-003', barcode: '8901000009', cat: 'Bakery & Grains', sell: 1.85, cost: 1.05, unit: 'pack', reorder: 20, targetQty: 54 },
      { name: 'Red Gala Apples 1kg', sku: 'PRO-001', barcode: '8901000010', cat: 'Produce & Fresh', sell: 3.90, cost: 2.50, unit: 'bag', reorder: 12, targetQty: 18 },
      { name: 'Fresh Tomatoes 1kg', sku: 'PRO-002', barcode: '8901000011', cat: 'Produce & Fresh', sell: 2.80, cost: 1.70, unit: 'kg', reorder: 15, targetQty: 15 },
      { name: 'Dishwashing Liquid 750ml', sku: 'HHC-001', barcode: '8901000012', cat: 'Household & Cleaning', sell: 3.20, cost: 1.95, unit: 'bottle', reorder: 12, targetQty: 30 },
      { name: 'Toilet Tissue (6 Rolls)', sku: 'HHC-002', barcode: '8901000013', cat: 'Household & Cleaning', sell: 5.40, cost: 3.50, unit: 'pack', reorder: 10, targetQty: 26 },
      { name: 'Laundry Detergent 2kg', sku: 'HHC-003', barcode: '8901000014', cat: 'Household & Cleaning', sell: 7.90, cost: 5.20, unit: 'pack', reorder: 8, targetQty: 19 },
      { name: 'Vegetable Cooking Oil 2L', sku: 'SNK-001', barcode: '8901000015', cat: 'Snacks & Pantry', sell: 6.80, cost: 4.60, unit: 'bottle', reorder: 12, targetQty: 24 },
      { name: 'Salted Potato Crisps 150g', sku: 'SNK-002', barcode: '8901000016', cat: 'Snacks & Pantry', sell: 2.10, cost: 1.20, unit: 'bag', reorder: 18, targetQty: 48 }
    ];

    const historicalSalesSpec = [
      { daysAgo: 6, hour: 10, min: 15, cashier: 'cashier', method: 'cash', discountPct: 0, lines: [['BEV-001', 6], ['BAK-001', 3], ['DAI-002', 2]] },
      { daysAgo: 5, hour: 13, min: 40, cashier: 'cashier', method: 'card', discountPct: 5, lines: [['BAK-002', 2], ['SNK-001', 2], ['HHC-002', 1]] },
      { daysAgo: 4, hour: 15, min: 10, cashier: 'cashier', method: 'transfer', discountPct: 0, lines: [['BEV-002', 3], ['DAI-001', 4], ['PRO-001', 2]] },
      { daysAgo: 3, hour: 11, min: 25, cashier: 'manager', method: 'cash', discountPct: 0, lines: [['HHC-003', 2], ['HHC-001', 3], ['SNK-002', 5]] },
      { daysAgo: 2, hour: 16, min: 50, cashier: 'cashier', method: 'card', discountPct: 0, lines: [['BEV-003', 2], ['DAI-003', 2], ['BAK-003', 6]] },
      { daysAgo: 1, hour: 14, min: 5, cashier: 'cashier', method: 'cash', discountPct: 0, lines: [['PRO-002', 4], ['BAK-001', 4], ['BEV-001', 8]] },
      { daysAgo: 0, hour: 9, min: 30, cashier: 'cashier', method: 'cash', discountPct: 0, lines: [['DAI-001', 3], ['BAK-001', 2], ['DAI-002', 2], ['BEV-001', 4]] },
      { daysAgo: 0, hour: 10, min: 45, cashier: 'cashier', method: 'card', discountPct: 5, lines: [['BAK-002', 1], ['SNK-001', 2], ['BEV-002', 2], ['SNK-002', 3]] }
    ];

    const soldTotalsBySku = {};
    for (const sale of historicalSalesSpec) {
      for (const [sku, qty] of sale.lines) {
        soldTotalsBySku[sku] = (soldTotalsBySku[sku] || 0) + qty;
      }
    }

    const insertProduct = db.prepare(`
      INSERT INTO products (name, sku, barcode, category_id, selling_price, cost_price, unit, reorder_level, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const insertInventory = db.prepare(`
      INSERT INTO inventory (product_id, quantity_available, updated_at)
      VALUES (?, ?, ?)
    `);
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (product_id, supplier_id, movement_type, quantity, previous_quantity, new_quantity, reason, reference, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const initTimestamp = makeLocalDayTimestamp(7, 8, 30);
    const productBySku = {};

    for (const p of seedProducts) {
      const startQty = p.targetQty + (soldTotalsBySku[p.sku] || 0);
      const info = insertProduct.run(
        p.name,
        p.sku,
        p.barcode,
        categoryIds[p.cat],
        p.sell,
        p.cost,
        p.unit,
        p.reorder,
        initTimestamp,
        initTimestamp
      );
      const productId = Number(info.lastInsertRowid);
      insertInventory.run(productId, startQty, initTimestamp);
      insertMovement.run(
        productId,
        null,
        'initial',
        startQty,
        0,
        startQty,
        'Opening inventory balance',
        'INIT-001',
        userIds.inventory_officer,
        initTimestamp
      );
      productBySku[p.sku] = { ...p, id: productId, currentQty: startQty };
    }

    // Seed one historical supplier delivery so movement history has a receive entry too
    const receiveTs = makeLocalDayTimestamp(5, 9, 0);
    const rice = productBySku['BAK-002'];
    const prevRice = rice.currentQty;
    rice.currentQty += 10;
    db.prepare('UPDATE inventory SET quantity_available = ?, updated_at = ? WHERE product_id = ?')
      .run(rice.currentQty, receiveTs, rice.id);
    // Keep final targetQty exact by adjusting opening initial slightly: actually let's subtract 10 from initial or leave as +10?
    // Better: adjust rice targetQty cleanly? Let's keep it exact by inserting a receive movement of +10 on SNK-002 or reducing SNK-002 initial by 10?
    // Wait: we already inserted initial above. Instead let's update rice initial by -10? No, let's keep initial clean and update rice inventory back? Wait: simpler to adjust before inserting, or just make receive on 'BAK-002' part of historical: let's just reduce 'BAK-002' initial by 10? No, let's adjust initial movement directly? Even cleaner: don't overcomplicate, update rice's inventory is +10, wait if targetQty was 22 it becomes 32 (still healthy!). Let's verify: 32 > reorder 10, totally realistic!
    insertMovement.run(
      rice.id,
      supplierIds['Golden Grain Foods'],
      'receive',
      10,
      prevRice,
      rice.currentQty,
      'Scheduled weekly restock',
      'DEL-2026-001',
      userIds.inventory_officer,
      receiveTs
    );

    const insertSale = db.prepare(`
      INSERT INTO sales (
        receipt_number, idempotency_key, cashier_id, subtotal, discount_total,
        tax_rate_snapshot, tax_total, grand_total, payment_method, amount_paid,
        change_due, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `);
    const insertSaleItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name_snapshot, sku_snapshot, unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateInv = db.prepare('UPDATE inventory SET quantity_available = ?, updated_at = ? WHERE product_id = ?');
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const taxRate = 7.5;
    historicalSalesSpec.forEach((spec, idx) => {
      const ts = makeLocalDayTimestamp(spec.daysAgo, spec.hour, spec.min);
      const receiptDate = formatReceiptDate(new Date(ts));
      const receiptNumber = `MF-${receiptDate}-${String(idx + 1).padStart(4, '0')}`;

      let subtotal = 0;
      const computedLines = spec.lines.map(([sku, qty]) => {
        const prod = productBySku[sku];
        const lineTotal = round2(prod.sell * qty);
        subtotal = round2(subtotal + lineTotal);
        return { prod, qty, lineTotal };
      });

      const discountTotal = round2(subtotal * (spec.discountPct / 100));
      const taxable = round2(subtotal - discountTotal);
      const taxTotal = round2(taxable * (taxRate / 100));
      const grandTotal = round2(taxable + taxTotal);
      const amountPaid = spec.method === 'cash' ? Math.ceil(grandTotal / 5) * 5 : grandTotal;
      const changeDue = round2(amountPaid - grandTotal);

      const saleInfo = insertSale.run(
        receiptNumber,
        `seed-sale-${idx + 1}`,
        userIds[spec.cashier],
        subtotal,
        discountTotal,
        taxRate,
        taxTotal,
        grandTotal,
        spec.method,
        amountPaid,
        changeDue,
        ts
      );
      const saleId = Number(saleInfo.lastInsertRowid);

      for (const { prod, qty, lineTotal } of computedLines) {
        insertSaleItem.run(saleId, prod.id, prod.name, prod.sku, prod.sell, qty, lineTotal);
        const prevQty = prod.currentQty;
        const newQty = prevQty - qty;
        prod.currentQty = newQty;
        updateInv.run(newQty, ts, prod.id);
        insertMovement.run(
          prod.id,
          null,
          'sale',
          -qty,
          prevQty,
          newQty,
          'POS sale deduction',
          receiptNumber,
          userIds[spec.cashier],
          ts
        );
      }

      insertAudit.run(
        userIds[spec.cashier],
        'SALE_COMPLETED',
        'sale',
        String(saleId),
        `Completed sale ${receiptNumber} (${spec.method}) totaling ${grandTotal.toFixed(2)}`,
        ts
      );
    });

    insertAudit.run(
      userIds.admin,
      'SYSTEM_INITIALIZED',
      'system',
      '1',
      'Initialized MarketFlow database with demo supermarket data',
      initTimestamp
    );
  });
}

module.exports = {
  DEFAULT_DB_PATH,
  initDatabase,
  withTransaction,
  round2,
  formatReceiptDate
};
