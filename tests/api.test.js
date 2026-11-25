const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initDatabase, round2 } = require('../db/database');
const { createApp } = require('../src/app');

function createClient(baseUrl) {
  let cookie = '';
  return {
    async request(method, urlPath, body) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });

      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        cookie = setCookie.split(';')[0];
      }

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        data = text;
      }
      return { status: res.status, data, headers: res.headers };
    },
    async login(email, password) {
      return this.request('POST', '/api/auth/login', { email, password });
    },
    async logout() {
      const res = await this.request('POST', '/api/auth/logout');
      cookie = '';
      return res;
    }
  };
}

describe('MarketFlow API & Business Logic Tests', () => {
  let tmpDir;
  let dbPath;
  let db;
  let server;
  let baseUrl;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketflow-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    db = initDatabase(dbPath);
    const app = createApp(db);

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (db) {
      db.close();
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      // Ignore transient Windows file lock if any
    }
  });

  it('serves frontend pages and local offline vendor assets with HTTP 200', async () => {
    const client = createClient(baseUrl);
    for (const p of [
      '/login.html',
      '/',
      '/css/styles.css',
      '/vendor/bootstrap/css/bootstrap.min.css',
      '/vendor/bootstrap/js/bootstrap.bundle.min.js',
      '/vendor/bootstrap-icons/bootstrap-icons.min.css',
      '/vendor/chart.js/chart.umd.js'
    ]) {
      const res = await client.request('GET', p);
      assert.equal(res.status, 200, `Expected 200 for ${p}`);
    }
  });

  it('rejects unauthenticated access and invalid logins without leaking password hashes', async () => {
    const client = createClient(baseUrl);

    const unauth = await client.request('GET', '/api/auth/me');
    assert.equal(unauth.status, 401);

    const badLogin = await client.login('cashier@marketflow.local', 'wrongpassword');
    assert.equal(badLogin.status, 401);
    assert.match(badLogin.data.error, /invalid/i);

    const goodLogin = await client.login('cashier@marketflow.local', 'cashier123');
    assert.equal(goodLogin.status, 200);
    assert.equal(goodLogin.data.user.role_name, 'cashier');
    assert.equal(Object.hasOwn(goodLogin.data.user, 'password_hash'), false);
  });

  it('rejects tampered session cookies and clears cookie cleanly on logout', async () => {
    const forgedRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: 'mf_session=eyJ1aWQiOjEsImV4cCI6OTk5OTk5OTk5OTk5OX0.invalidsig' }
    });
    assert.equal(forgedRes.status, 401);

    const client = createClient(baseUrl);
    const loginRes = await client.login('cashier@marketflow.local', 'cashier123');
    assert.equal(loginRes.status, 200);

    const meBefore = await client.request('GET', '/api/auth/me');
    assert.equal(meBefore.status, 200);

    const logoutRes = await client.request('POST', '/api/auth/logout');
    assert.equal(logoutRes.status, 200);

    const meAfter = await client.request('GET', '/api/auth/me');
    assert.equal(meAfter.status, 401);
  });

  it('blocks deactivated staff accounts from logging in', async () => {
    const admin = createClient(baseUrl);
    const loginAdmin = await admin.login('admin@marketflow.local', 'admin123');
    assert.equal(loginAdmin.status, 200);

    const rolesRes = await admin.request('GET', '/api/roles');
    const cashierRole = rolesRes.data.roles.find((r) => r.name === 'cashier');

    const createRes = await admin.request('POST', '/api/users', {
      full_name: 'Temp Inactive Staff',
      email: 'inactive.staff@marketflow.local',
      password: 'password123',
      role_id: cashierRole.id,
      status: 'inactive'
    });
    assert.equal(createRes.status, 201);

    const inactiveClient = createClient(baseUrl);
    const attempt = await inactiveClient.login('inactive.staff@marketflow.local', 'password123');
    assert.equal(attempt.status, 403);
  });

  it('enforces strict role-based access control across Cashier and Inventory Officer', async () => {
    const cashier = createClient(baseUrl);
    await cashier.login('cashier@marketflow.local', 'cashier123');

    assert.equal((await cashier.request('GET', '/api/reports/dashboard')).status, 403);
    assert.equal((await cashier.request('GET', '/api/reports/sales')).status, 403);
    assert.equal((await cashier.request('GET', '/api/audit-logs')).status, 403);
    assert.equal((await cashier.request('GET', '/api/users')).status, 403);
    assert.equal((await cashier.request('POST', '/api/products', { name: 'Hack', sku: 'H-1', category_id: 1, selling_price: 1 })).status, 403);
    assert.equal((await cashier.request('POST', '/api/inventory/adjust', { product_id: 1, new_quantity: 5, reason: 'test' })).status, 403);

    // Seeded sale #4 belongs to manager; cashier must not see it in list or view its detail
    const manager = createClient(baseUrl);
    await manager.login('manager@marketflow.local', 'manager123');
    const mgrSalesRes = await manager.request('GET', '/api/sales');
    const managerOnlySale = mgrSalesRes.data.sales.find((s) => s.cashier_id !== cashier.userId && s.cashier_name === 'David Mensah');
    assert.ok(managerOnlySale, 'Expected seeded manager sale');

    const cashierSales = await cashier.request('GET', `/api/sales?cashier_id=${managerOnlySale.cashier_id}`);
    assert.equal(cashierSales.status, 200);
    assert.ok(cashierSales.data.sales.every((s) => s.cashier_name === 'Chidi Eze'));

    const forbiddenReceipt = await cashier.request('GET', `/api/sales/${managerOnlySale.id}`);
    assert.equal(forbiddenReceipt.status, 403);

    // Inventory officer cannot view financial reports, dashboard, users, or process POS sales
    const invOfficer = createClient(baseUrl);
    await invOfficer.login('inventory@marketflow.local', 'inventory123');
    assert.equal((await invOfficer.request('GET', '/api/reports/dashboard')).status, 403);
    assert.equal((await invOfficer.request('GET', '/api/reports/sales')).status, 403);
    assert.equal((await invOfficer.request('GET', '/api/users')).status, 403);
    assert.equal((await invOfficer.request('POST', '/api/sales', {
      items: [{ product_id: 1, quantity: 1 }],
      payment_method: 'cash',
      amount_paid: 10
    })).status, 403);
  });

  it('creates products and rejects duplicate SKUs with 409', async () => {
    const invOfficer = createClient(baseUrl);
    await invOfficer.login('inventory@marketflow.local', 'inventory123');

    const createRes = await invOfficer.request('POST', '/api/products', {
      name: 'Test Green Tea 250g',
      sku: 'BEV-TEST-01',
      barcode: '8909990001',
      category_id: 1,
      selling_price: 4.5,
      cost_price: 2.5,
      unit: 'box',
      reorder_level: 10,
      initial_stock: 15
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.data.product.quantity_available, 15);

    const dupSku = await invOfficer.request('POST', '/api/products', {
      name: 'Duplicate SKU Product',
      sku: 'BEV-TEST-01',
      category_id: 1,
      selling_price: 5.0
    });
    assert.equal(dupSku.status, 409);
  });

  it('rolls back multi-item sale atomically when any item lacks stock', async () => {
    const cashier = createClient(baseUrl);
    await cashier.login('cashier@marketflow.local', 'cashier123');

    const prodsRes = await cashier.request('GET', '/api/products?active=1');
    const water = prodsRes.data.products.find((p) => p.sku === 'BEV-001');
    const juice = prodsRes.data.products.find((p) => p.sku === 'BEV-002');
    const initialWaterQty = water.quantity_available;
    const initialJuiceQty = juice.quantity_available;

    const salesCountBefore = db.prepare('SELECT COUNT(*) AS cnt FROM sales').get().cnt;

    // Request 2 units of water (valid) and 9999 units of juice (insufficient)
    const failSale = await cashier.request('POST', '/api/sales', {
      items: [
        { product_id: water.id, quantity: 2 },
        { product_id: juice.id, quantity: 9999 }
      ],
      payment_method: 'cash',
      amount_paid: 50000
    });
    assert.equal(failSale.status, 400);
    assert.match(failSale.data.error, /Insufficient stock/i);

    const waterAfter = db.prepare('SELECT quantity_available FROM inventory WHERE product_id = ?').get(water.id).quantity_available;
    const juiceAfter = db.prepare('SELECT quantity_available FROM inventory WHERE product_id = ?').get(juice.id).quantity_available;
    const salesCountAfter = db.prepare('SELECT COUNT(*) AS cnt FROM sales').get().cnt;

    assert.equal(waterAfter, initialWaterQty);
    assert.equal(juiceAfter, initialJuiceQty);
    assert.equal(salesCountAfter, salesCountBefore);
  });

  it('computes totals server-side, protects against double submit via idempotency_key, and preserves historical snapshots', async () => {
    const cashier = createClient(baseUrl);
    await cashier.login('cashier@marketflow.local', 'cashier123');

    const prodsRes = await cashier.request('GET', '/api/products?active=1');
    const prod = prodsRes.data.products.find((p) => p.sku === 'BEV-TEST-01');
    const startStock = prod.quantity_available; // 15

    const idempKey = 'test-idemp-checkout-001';
    const qty = 3;
    const discountPct = 10; // Cashier max is 10%
    // Expected: subtotal = 4.50 * 3 = 13.50; discount = 1.35; taxable = 12.15; tax 7.5% = 0.91; grand = 13.06
    const expectedSubtotal = round2(prod.selling_price * qty);
    const expectedDiscount = round2(expectedSubtotal * 0.10);
    const expectedTax = round2(round2(expectedSubtotal - expectedDiscount) * 0.075);
    const expectedGrand = round2(expectedSubtotal - expectedDiscount + expectedTax);

    // Send tampered prices/totals from client to verify backend ignores them
    const firstRes = await cashier.request('POST', '/api/sales', {
      items: [{ product_id: prod.id, quantity: qty, unit_price: 0.01 }],
      subtotal: 0.03,
      grand_total: 0.03,
      discount_percent: discountPct,
      payment_method: 'cash',
      amount_paid: 20,
      idempotency_key: idempKey
    });

    assert.equal(firstRes.status, 201);
    assert.equal(firstRes.data.sale.subtotal, expectedSubtotal);
    assert.equal(firstRes.data.sale.discount_total, expectedDiscount);
    assert.equal(firstRes.data.sale.tax_total, expectedTax);
    assert.equal(firstRes.data.sale.grand_total, expectedGrand);
    assert.equal(firstRes.data.sale.change_due, round2(20 - expectedGrand));

    const stockAfterFirst = db.prepare('SELECT quantity_available FROM inventory WHERE product_id = ?').get(prod.id).quantity_available;
    assert.equal(stockAfterFirst, startStock - qty);

    // Duplicate retry with identical idempotency_key must NOT deduct stock again
    const retryRes = await cashier.request('POST', '/api/sales', {
      items: [{ product_id: prod.id, quantity: qty }],
      discount_percent: discountPct,
      payment_method: 'cash',
      amount_paid: 20,
      idempotency_key: idempKey
    });
    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.data.duplicate, true);
    assert.equal(retryRes.data.sale.id, firstRes.data.sale.id);

    const stockAfterRetry = db.prepare('SELECT quantity_available FROM inventory WHERE product_id = ?').get(prod.id).quantity_available;
    assert.equal(stockAfterRetry, startStock - qty);

    // Cashier exceeding discount cap (e.g. 25% > 10%) must be blocked
    const excessiveDisc = await cashier.request('POST', '/api/sales', {
      items: [{ product_id: prod.id, quantity: 1 }],
      discount_percent: 25,
      payment_method: 'cash',
      amount_paid: 10
    });
    assert.equal(excessiveDisc.status, 403);

    // Manager edits product price & name; historical receipt snapshot must remain unchanged
    const manager = createClient(baseUrl);
    await manager.login('manager@marketflow.local', 'manager123');
    const patchRes = await manager.request('PATCH', `/api/products/${prod.id}`, {
      name: 'Renamed Green Tea 250g',
      selling_price: 9.99
    });
    assert.equal(patchRes.status, 200);

    const receiptCheck = await manager.request('GET', `/api/sales/${firstRes.data.sale.id}`);
    assert.equal(receiptCheck.status, 200);
    assert.equal(receiptCheck.data.items[0].product_name_snapshot, 'Test Green Tea 250g');
    assert.equal(receiptCheck.data.items[0].unit_price, 4.5);
  });

  it('handles stock receiving, stock adjustments with mandatory reason, low-stock alerts, and audit log', async () => {
    const inv = createClient(baseUrl);
    await inv.login('inventory@marketflow.local', 'inventory123');

    const invRes = await inv.request('GET', '/api/inventory?status=low_stock');
    assert.equal(invRes.status, 200);
    const orangeJuice = invRes.data.items.find((i) => i.sku === 'BEV-002');
    assert.ok(orangeJuice, 'Expected BEV-002 to be flagged as low stock initially');
    assert.ok(orangeJuice.quantity_available <= orangeJuice.reorder_level);

    // Receive +20 cartons of BEV-002
    const recRes = await inv.request('POST', '/api/inventory/receive', {
      supplier_id: 2,
      reference: 'DEL-TEST-99',
      delivery_date: '2026-11-25',
      items: [{ product_id: orangeJuice.id, quantity: 20 }]
    });
    assert.equal(recRes.status, 201);
    assert.equal(recRes.data.movements[0].new_quantity, orangeJuice.quantity_available + 20);

    // Adjustment without reason must fail
    const badAdj = await inv.request('POST', '/api/inventory/adjust', {
      product_id: orangeJuice.id,
      new_quantity: 25,
      reason: '   '
    });
    assert.equal(badAdj.status, 400);

    // Valid adjustment updates quantity and creates movement + audit entry
    const goodAdj = await inv.request('POST', '/api/inventory/adjust', {
      product_id: orangeJuice.id,
      new_quantity: 25,
      reason: 'Damaged carton during shelving'
    });
    assert.equal(goodAdj.status, 201);
    assert.equal(goodAdj.data.adjustment.previous_quantity, orangeJuice.quantity_available + 20);
    assert.equal(goodAdj.data.adjustment.new_quantity, 25);

    const movRes = await inv.request('GET', `/api/inventory/movements?product_id=${orangeJuice.id}`);
    assert.equal(movRes.status, 200);
    assert.ok(movRes.data.movements.some((m) => m.movement_type === 'adjustment' && m.reason.includes('Damaged carton')));
  });

  it('supports report filtering and manager-only sale voiding with atomic stock restoration', async () => {
    const cashier = createClient(baseUrl);
    await cashier.login('cashier@marketflow.local', 'cashier123');

    const prodsRes = await cashier.request('GET', '/api/products?active=1');
    const pasta = prodsRes.data.products.find((p) => p.sku === 'BAK-003');
    const stockBeforeSale = pasta.quantity_available;

    const saleRes = await cashier.request('POST', '/api/sales', {
      items: [{ product_id: pasta.id, quantity: 4 }],
      payment_method: 'transfer',
      idempotency_key: 'test-void-sale-001'
    });
    assert.equal(saleRes.status, 201);
    const saleId = saleRes.data.sale.id;

    // Cashier cannot void
    const cashierVoid = await cashier.request('POST', `/api/sales/${saleId}/void`, { reason: 'Customer changed mind' });
    assert.equal(cashierVoid.status, 403);

    // Manager voids with reason -> stock restored
    const manager = createClient(baseUrl);
    await manager.login('manager@marketflow.local', 'manager123');
    const mgrVoid = await manager.request('POST', `/api/sales/${saleId}/void`, { reason: 'Duplicate checkout' });
    assert.equal(mgrVoid.status, 200);
    assert.equal(mgrVoid.data.sale.status, 'voided');

    const stockAfterVoid = db.prepare('SELECT quantity_available FROM inventory WHERE product_id = ?').get(pasta.id).quantity_available;
    assert.equal(stockAfterVoid, stockBeforeSale);

    // Reports filter cleanly and audit logs contain SALE_VOIDED
    const repRes = await manager.request('GET', '/api/reports/sales?period=daily');
    assert.equal(repRes.status, 200);
    assert.ok(repRes.data.summary.voided_count >= 1);

    const auditRes = await manager.request('GET', '/api/audit-logs?action=SALE_VOIDED');
    assert.equal(auditRes.status, 200);
    assert.ok(auditRes.data.logs.some((l) => l.entity_id === String(saleId)));
  });
});
