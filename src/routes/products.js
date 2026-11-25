const express = require('express');
const { withTransaction, round2 } = require('../../db/database');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

function createProductsRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const canEditProducts = requireRole('admin', 'manager', 'inventory_officer');

  const selectBase = `
    SELECT p.*, c.name AS category_name, COALESCE(i.quantity_available, 0) AS quantity_available
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory i ON i.product_id = p.id
  `;

  router.get('/', auth, (req, res, next) => {
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

      if (req.query.active === '1' || req.query.active === 'true') {
        clauses.push('p.active = 1');
      } else if (req.query.active === '0' || req.query.active === 'false') {
        clauses.push('p.active = 0');
      }

      if (req.query.low_stock === 'true' || req.query.low_stock === '1') {
        clauses.push('p.active = 1 AND COALESCE(i.quantity_available, 0) <= p.reorder_level');
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const products = db.prepare(`${selectBase} ${whereSql} ORDER BY p.name ASC`).all(...params);

      return res.json({ products });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', auth, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw HttpError(400, 'Invalid product ID');

      const product = db.prepare(`${selectBase} WHERE p.id = ?`).get(id);
      if (!product) throw HttpError(404, 'Product not found');

      return res.json({ product });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', auth, canEditProducts, (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      const sku = String(req.body?.sku || '').trim().toUpperCase();
      const barcodeRaw = req.body?.barcode !== undefined && req.body?.barcode !== null
        ? String(req.body.barcode).trim()
        : '';
      const barcode = barcodeRaw || null;
      const categoryId = Number(req.body?.category_id);
      const sellingPrice = Number(req.body?.selling_price);
      const costPrice = req.body?.cost_price !== undefined && req.body?.cost_price !== ''
        ? Number(req.body.cost_price)
        : 0;
      const unit = String(req.body?.unit || 'pcs').trim() || 'pcs';
      const reorderLevel = req.body?.reorder_level !== undefined && req.body?.reorder_level !== ''
        ? Number(req.body.reorder_level)
        : 10;
      const initialStock = req.body?.initial_stock !== undefined && req.body?.initial_stock !== ''
        ? Number(req.body.initial_stock)
        : 0;
      const active = req.body?.active === 0 || req.body?.active === false ? 0 : 1;

      if (!name) throw HttpError(400, 'Product name is required');
      if (!sku) throw HttpError(400, 'SKU is required');
      if (!Number.isInteger(categoryId)) throw HttpError(400, 'Valid category is required');
      if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
        throw HttpError(400, 'Selling price must be 0 or higher');
      }
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        throw HttpError(400, 'Cost price must be 0 or higher');
      }
      if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
        throw HttpError(400, 'Reorder level must be a non-negative whole number');
      }
      if (!Number.isInteger(initialStock) || initialStock < 0) {
        throw HttpError(400, 'Initial stock must be a non-negative whole number');
      }

      const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
      if (!category) throw HttpError(400, 'Selected category does not exist');

      const dupSku = db.prepare('SELECT id FROM products WHERE UPPER(sku) = ?').get(sku);
      if (dupSku) throw HttpError(409, `SKU "${sku}" is already assigned to another product`);

      if (barcode) {
        const dupBarcode = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
        if (dupBarcode) throw HttpError(409, `Barcode "${barcode}" is already assigned to another product`);
      }

      const now = new Date().toISOString();
      const productId = withTransaction(db, () => {
        const info = db.prepare(`
          INSERT INTO products (
            name, sku, barcode, category_id, selling_price, cost_price,
            unit, reorder_level, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          name,
          sku,
          barcode,
          categoryId,
          round2(sellingPrice),
          round2(costPrice),
          unit,
          reorderLevel,
          active,
          now,
          now
        );

        const newId = Number(info.lastInsertRowid);
        db.prepare(`
          INSERT INTO inventory (product_id, quantity_available, updated_at)
          VALUES (?, ?, ?)
        `).run(newId, initialStock, now);

        if (initialStock > 0) {
          db.prepare(`
            INSERT INTO stock_movements (
              product_id, supplier_id, movement_type, quantity,
              previous_quantity, new_quantity, reason, reference, user_id, created_at
            ) VALUES (?, NULL, 'initial', ?, 0, ?, 'Initial stock on product creation', ?, ?, ?)
          `).run(newId, initialStock, initialStock, `SKU:${sku}`, req.user.id, now);
        }

        logAudit(db, {
          userId: req.user.id,
          action: 'PRODUCT_CREATED',
          entityType: 'product',
          entityId: newId,
          details: `Created product "${name}" (${sku}) at ${round2(sellingPrice).toFixed(2)} with initial stock ${initialStock}`
        });

        return newId;
      });

      const product = db.prepare(`${selectBase} WHERE p.id = ?`).get(productId);
      return res.status(201).json({ product });
    } catch (err) {
      if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
        return next(HttpError(409, 'SKU or barcode already exists'));
      }
      return next(err);
    }
  });

  router.patch('/:id', auth, canEditProducts, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw HttpError(400, 'Invalid product ID');

      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!existing) throw HttpError(404, 'Product not found');

      const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
      const sku = req.body?.sku !== undefined ? String(req.body.sku).trim().toUpperCase() : existing.sku;
      let barcode = existing.barcode;
      if (req.body?.barcode !== undefined) {
        const b = req.body.barcode === null ? '' : String(req.body.barcode).trim();
        barcode = b || null;
      }
      const categoryId = req.body?.category_id !== undefined ? Number(req.body.category_id) : existing.category_id;
      const sellingPrice = req.body?.selling_price !== undefined ? Number(req.body.selling_price) : existing.selling_price;
      const costPrice = req.body?.cost_price !== undefined ? Number(req.body.cost_price) : existing.cost_price;
      const unit = req.body?.unit !== undefined ? String(req.body.unit).trim() : existing.unit;
      const reorderLevel = req.body?.reorder_level !== undefined ? Number(req.body.reorder_level) : existing.reorder_level;
      const active = req.body?.active !== undefined
        ? (req.body.active === 0 || req.body.active === false || req.body.active === '0' ? 0 : 1)
        : existing.active;

      if (!name) throw HttpError(400, 'Product name cannot be empty');
      if (!sku) throw HttpError(400, 'SKU cannot be empty');
      if (!unit) throw HttpError(400, 'Unit cannot be empty');
      if (!Number.isInteger(categoryId)) throw HttpError(400, 'Valid category is required');
      if (!Number.isFinite(sellingPrice) || sellingPrice < 0) throw HttpError(400, 'Selling price must be 0 or higher');
      if (!Number.isFinite(costPrice) || costPrice < 0) throw HttpError(400, 'Cost price must be 0 or higher');
      if (!Number.isInteger(reorderLevel) || reorderLevel < 0) throw HttpError(400, 'Reorder level must be >= 0');

      const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
      if (!category) throw HttpError(400, 'Selected category does not exist');

      const dupSku = db.prepare('SELECT id FROM products WHERE UPPER(sku) = ? AND id != ?').get(sku, id);
      if (dupSku) throw HttpError(409, `SKU "${sku}" is already used by another product`);

      if (barcode) {
        const dupBarcode = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(barcode, id);
        if (dupBarcode) throw HttpError(409, `Barcode "${barcode}" is already used by another product`);
      }

      const now = new Date().toISOString();
      const roundedSell = round2(sellingPrice);
      const roundedCost = round2(costPrice);

      withTransaction(db, () => {
        db.prepare(`
          UPDATE products
          SET name = ?, sku = ?, barcode = ?, category_id = ?, selling_price = ?,
              cost_price = ?, unit = ?, reorder_level = ?, active = ?, updated_at = ?
          WHERE id = ?
        `).run(name, sku, barcode, categoryId, roundedSell, roundedCost, unit, reorderLevel, active, now, id);

        if (roundedSell !== existing.selling_price) {
          logAudit(db, {
            userId: req.user.id,
            action: 'PRICE_CHANGED',
            entityType: 'product',
            entityId: id,
            details: `Changed selling price of "${name}" (${sku}) from ${existing.selling_price.toFixed(2)} to ${roundedSell.toFixed(2)}`
          });
        }
        if (active !== existing.active) {
          logAudit(db, {
            userId: req.user.id,
            action: 'PRODUCT_STATUS_CHANGED',
            entityType: 'product',
            entityId: id,
            details: `${active ? 'Activated' : 'Deactivated'} product "${name}" (${sku})`
          });
        }
        if (roundedSell === existing.selling_price && active === existing.active) {
          logAudit(db, {
            userId: req.user.id,
            action: 'PRODUCT_UPDATED',
            entityType: 'product',
            entityId: id,
            details: `Updated product details for "${name}" (${sku})`
          });
        }
      });

      const product = db.prepare(`${selectBase} WHERE p.id = ?`).get(id);
      return res.json({ product });
    } catch (err) {
      if (err && err.message && err.message.includes('UNIQUE constraint failed')) {
        return next(HttpError(409, 'SKU or barcode already exists'));
      }
      return next(err);
    }
  });

  return router;
}

module.exports = createProductsRouter;
