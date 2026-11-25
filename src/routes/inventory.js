const express = require('express');
const { withTransaction } = require('../../db/database');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

function classifyStockStatus(qty, reorderLevel) {
  if (qty <= 0) return 'out_of_stock';
  if (qty <= reorderLevel) return 'low_stock';
  return 'healthy';
}

function createInventoryRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const canAccess = requireRole('admin', 'manager', 'inventory_officer');

  router.get('/', auth, canAccess, (req, res, next) => {
    try {
      const clauses = [];
      const params = [];

      const search = String(req.query.search || '').trim().toLowerCase();
      if (search) {
        clauses.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(COALESCE(p.barcode, \'\')) LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      if (req.query.category_id) {
        const catId = Number(req.query.category_id);
        if (Number.isInteger(catId)) {
          clauses.push('p.category_id = ?');
          params.push(catId);
        }
      }

      if (req.query.active !== 'all') {
        clauses.push('p.active = 1');
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      let items = db.prepare(`
        SELECT p.id, p.name, p.sku, p.barcode, p.category_id, p.selling_price, p.cost_price,
               p.unit, p.reorder_level, p.active,
               c.name AS category_name,
               COALESCE(i.quantity_available, 0) AS quantity_available,
               i.updated_at AS stock_updated_at
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN inventory i ON i.product_id = p.id
        ${whereSql}
        ORDER BY (COALESCE(i.quantity_available, 0) - p.reorder_level) ASC, p.name ASC
      `).all(...params).map((row) => ({
        ...row,
        stock_status: classifyStockStatus(row.quantity_available, row.reorder_level)
      }));

      const statusFilter = String(req.query.status || '').trim();
      if (['out_of_stock', 'low_stock', 'healthy'].includes(statusFilter)) {
        if (statusFilter === 'low_stock') {
          items = items.filter((item) => item.stock_status === 'low_stock' || item.stock_status === 'out_of_stock');
        } else {
          items = items.filter((item) => item.stock_status === statusFilter);
        }
      }

      return res.json({ items });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/receive', auth, canAccess, (req, res, next) => {
    try {
      const supplierId = Number(req.body?.supplier_id);
      const reference = String(req.body?.reference || '').trim() || `DEL-${Date.now()}`;
      const deliveryDate = String(req.body?.delivery_date || '').trim();
      const notes = String(req.body?.notes || '').trim();
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

      if (!Number.isInteger(supplierId)) throw HttpError(400, 'Please select a valid supplier');
      const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(supplierId);
      if (!supplier) throw HttpError(404, 'Selected supplier not found');

      if (rawItems.length === 0) throw HttpError(400, 'Add at least one product to receive');

      const merged = new Map();
      for (const entry of rawItems) {
        const productId = Number(entry?.product_id);
        const qty = Number(entry?.quantity);
        if (!Number.isInteger(productId)) throw HttpError(400, 'Invalid product in delivery items');
        if (!Number.isInteger(qty) || qty <= 0) {
          throw HttpError(400, 'Received quantity must be a positive whole number');
        }
        merged.set(productId, (merged.get(productId) || 0) + qty);
      }

      const now = new Date().toISOString();
      const reasonText = notes
        ? `${notes}${deliveryDate ? ` (Delivery date: ${deliveryDate})` : ''}`
        : `Supplier delivery from ${supplier.name}${deliveryDate ? ` (${deliveryDate})` : ''}`;

      const result = withTransaction(db, () => {
        const selectProduct = db.prepare(`
          SELECT p.id, p.name, p.sku, COALESCE(i.quantity_available, 0) AS quantity_available
          FROM products p
          LEFT JOIN inventory i ON i.product_id = p.id
          WHERE p.id = ?
        `);
        const updateInv = db.prepare(`
          UPDATE inventory SET quantity_available = ?, updated_at = ? WHERE product_id = ?
        `);
        const ensureInv = db.prepare(`
          INSERT OR IGNORE INTO inventory (product_id, quantity_available, updated_at) VALUES (?, 0, ?)
        `);
        const insertMov = db.prepare(`
          INSERT INTO stock_movements (
            product_id, supplier_id, movement_type, quantity,
            previous_quantity, new_quantity, reason, reference, user_id, created_at
          ) VALUES (?, ?, 'receive', ?, ?, ?, ?, ?, ?, ?)
        `);

        const movements = [];
        for (const [productId, qty] of merged.entries()) {
          const prod = selectProduct.get(productId);
          if (!prod) throw HttpError(404, `Product ID ${productId} not found`);

          ensureInv.run(productId, now);
          const prevQty = prod.quantity_available;
          const newQty = prevQty + qty;
          updateInv.run(newQty, now, productId);

          const movInfo = insertMov.run(
            productId,
            supplierId,
            qty,
            prevQty,
            newQty,
            reasonText,
            reference,
            req.user.id,
            now
          );
          movements.push({
            id: Number(movInfo.lastInsertRowid),
            product_id: productId,
            product_name: prod.name,
            sku: prod.sku,
            quantity: qty,
            previous_quantity: prevQty,
            new_quantity: newQty
          });
        }

        const totalUnits = movements.reduce((acc, m) => acc + m.quantity, 0);
        logAudit(db, {
          userId: req.user.id,
          action: 'STOCK_RECEIVED',
          entityType: 'inventory',
          entityId: reference,
          details: `Received ${totalUnits} units across ${movements.length} product(s) from ${supplier.name} (Ref: ${reference})`
        });

        return movements;
      });

      return res.status(201).json({
        message: 'Stock delivery recorded successfully',
        reference,
        supplier_name: supplier.name,
        movements: result
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/adjust', auth, canAccess, (req, res, next) => {
    try {
      const productId = Number(req.body?.product_id);
      const newQuantity = Number(req.body?.new_quantity);
      const reason = String(req.body?.reason || '').trim();

      if (!Number.isInteger(productId)) throw HttpError(400, 'Valid product is required');
      if (!Number.isInteger(newQuantity) || newQuantity < 0) {
        throw HttpError(400, 'New stock quantity must be a non-negative whole number');
      }
      if (!reason) throw HttpError(400, 'A reason is required for stock adjustments');

      const now = new Date().toISOString();
      const result = withTransaction(db, () => {
        const prod = db.prepare(`
          SELECT p.id, p.name, p.sku, COALESCE(i.quantity_available, 0) AS quantity_available
          FROM products p
          LEFT JOIN inventory i ON i.product_id = p.id
          WHERE p.id = ?
        `).get(productId);
        if (!prod) throw HttpError(404, 'Product not found');

        const prevQty = prod.quantity_available;
        const delta = newQuantity - prevQty;
        if (delta === 0) {
          throw HttpError(400, 'New quantity matches the current quantity; no adjustment needed');
        }

        db.prepare('INSERT OR IGNORE INTO inventory (product_id, quantity_available, updated_at) VALUES (?, 0, ?)')
          .run(productId, now);
        db.prepare('UPDATE inventory SET quantity_available = ?, updated_at = ? WHERE product_id = ?')
          .run(newQuantity, now, productId);

        const movInfo = db.prepare(`
          INSERT INTO stock_movements (
            product_id, supplier_id, movement_type, quantity,
            previous_quantity, new_quantity, reason, reference, user_id, created_at
          ) VALUES (?, NULL, 'adjustment', ?, ?, ?, ?, ?, ?, ?)
        `).run(productId, delta, prevQty, newQuantity, reason, `ADJ-${Date.now()}`, req.user.id, now);

        logAudit(db, {
          userId: req.user.id,
          action: 'STOCK_ADJUSTED',
          entityType: 'product',
          entityId: productId,
          details: `Adjusted "${prod.name}" (${prod.sku}) stock from ${prevQty} to ${newQuantity} (${delta > 0 ? `+${delta}` : delta}). Reason: ${reason}`
        });

        return {
          movement_id: Number(movInfo.lastInsertRowid),
          product_id: productId,
          product_name: prod.name,
          previous_quantity: prevQty,
          new_quantity: newQuantity,
          delta
        };
      });

      return res.status(201).json({ adjustment: result });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/movements', auth, canAccess, (req, res, next) => {
    try {
      const clauses = [];
      const params = [];

      if (req.query.product_id) {
        const pid = Number(req.query.product_id);
        if (Number.isInteger(pid)) {
          clauses.push('sm.product_id = ?');
          params.push(pid);
        }
      }

      if (req.query.movement_type) {
        clauses.push('sm.movement_type = ?');
        params.push(String(req.query.movement_type));
      }

      if (req.query.from) {
        clauses.push("date(sm.created_at, 'localtime') >= ?");
        params.push(String(req.query.from));
      }

      if (req.query.to) {
        clauses.push("date(sm.created_at, 'localtime') <= ?");
        params.push(String(req.query.to));
      }

      const search = String(req.query.search || '').trim().toLowerCase();
      if (search) {
        clauses.push('(LOWER(p.name) LIKE ? OR LOWER(p.sku) LIKE ? OR LOWER(sm.reference) LIKE ? OR LOWER(sm.reason) LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const movements = db.prepare(`
        SELECT sm.*, p.name AS product_name, p.sku, p.unit,
               s.name AS supplier_name,
               u.full_name AS user_name
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN suppliers s ON s.id = sm.supplier_id
        JOIN users u ON u.id = sm.user_id
        ${whereSql}
        ORDER BY sm.created_at DESC, sm.id DESC
        LIMIT 250
      `).all(...params);

      return res.json({ movements });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createInventoryRouter;
