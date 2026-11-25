const express = require('express');
const { withTransaction, round2, formatReceiptDate } = require('../../db/database');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { getSettingsMap } = require('../services/settings');

function createSalesRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const canSell = requireRole('admin', 'manager', 'cashier');
  const canVoid = requireRole('admin', 'manager');

  function getSaleDetailsById(saleId) {
    const sale = db.prepare(`
      SELECT s.*,
             c.full_name AS cashier_name,
             v.full_name AS voided_by_name
      FROM sales s
      JOIN users c ON c.id = s.cashier_id
      LEFT JOIN users v ON v.id = s.voided_by
      WHERE s.id = ?
    `).get(saleId);
    if (!sale) return null;

    const items = db.prepare(`
      SELECT si.*
      FROM sale_items si
      WHERE si.sale_id = ?
      ORDER BY si.id ASC
    `).all(saleId);

    return { sale, items };
  }

  function generateReceiptNumber(dateObj) {
    const dayPrefix = `MF-${formatReceiptDate(dateObj)}-`;
    const row = db.prepare('SELECT COUNT(*) AS count FROM sales WHERE receipt_number LIKE ?').get(`${dayPrefix}%`);
    let seq = (row ? row.count : 0) + 1;
    let candidate = `${dayPrefix}${String(seq).padStart(4, '0')}`;
    const check = db.prepare('SELECT id FROM sales WHERE receipt_number = ?');
    while (check.get(candidate)) {
      seq += 1;
      candidate = `${dayPrefix}${String(seq).padStart(4, '0')}`;
    }
    return candidate;
  }

  router.post('/', auth, canSell, (req, res, next) => {
    try {
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      const discountPercent = req.body?.discount_percent !== undefined && req.body?.discount_percent !== ''
        ? Number(req.body.discount_percent)
        : 0;
      const paymentMethod = String(req.body?.payment_method || '').trim().toLowerCase();
      const rawAmountPaid = req.body?.amount_paid;
      const idempotencyKey = typeof req.body?.idempotency_key === 'string' && req.body.idempotency_key.trim() !== ''
        ? req.body.idempotency_key.trim()
        : null;

      if (!['cash', 'card', 'transfer'].includes(paymentMethod)) {
        throw HttpError(400, 'Payment method must be cash, card, or transfer');
      }

      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        throw HttpError(400, 'Discount percentage must be between 0 and 100');
      }

      if (rawItems.length === 0) {
        throw HttpError(400, 'Cart cannot be empty');
      }

      const mergedItems = new Map();
      for (const entry of rawItems) {
        const productId = Number(entry?.product_id);
        const qty = Number(entry?.quantity);
        if (!Number.isInteger(productId)) throw HttpError(400, 'Invalid product in cart');
        if (!Number.isInteger(qty) || qty <= 0) {
          throw HttpError(400, 'Item quantity must be a positive whole number');
        }
        mergedItems.set(productId, (mergedItems.get(productId) || 0) + qty);
      }

      const settings = getSettingsMap(db);
      if (req.user.role_name === 'cashier' && discountPercent > settings.max_cashier_discount_percent) {
        throw HttpError(
          403,
          `Cashiers cannot apply a discount higher than ${settings.max_cashier_discount_percent}%`
        );
      }

      const outcome = withTransaction(db, () => {
        if (idempotencyKey) {
          const existingSale = db.prepare('SELECT id FROM sales WHERE idempotency_key = ?').get(idempotencyKey);
          if (existingSale) {
            return { ...getSaleDetailsById(existingSale.id), duplicate: true };
          }
        }

        const selectProduct = db.prepare(`
          SELECT p.id, p.name, p.sku, p.selling_price, p.active,
                 COALESCE(i.quantity_available, 0) AS quantity_available
          FROM products p
          LEFT JOIN inventory i ON i.product_id = p.id
          WHERE p.id = ?
        `);

        const preparedLines = [];
        let subtotal = 0;

        for (const [productId, qty] of mergedItems.entries()) {
          const prod = selectProduct.get(productId);
          if (!prod) {
            throw HttpError(404, `Product ID ${productId} does not exist`);
          }
          if (prod.active !== 1) {
            throw HttpError(400, `Product "${prod.name}" is inactive and cannot be sold`);
          }
          if (prod.quantity_available < qty) {
            throw HttpError(
              400,
              `Insufficient stock for "${prod.name}": requested ${qty}, only ${prod.quantity_available} available`
            );
          }

          const unitPrice = round2(prod.selling_price);
          const lineTotal = round2(unitPrice * qty);
          subtotal = round2(subtotal + lineTotal);

          preparedLines.push({
            productId: prod.id,
            name: prod.name,
            sku: prod.sku,
            unitPrice,
            qty,
            lineTotal,
            prevQty: prod.quantity_available,
            newQty: prod.quantity_available - qty
          });
        }

        const discountTotal = round2(subtotal * (discountPercent / 100));
        const taxableAmount = round2(subtotal - discountTotal);
        const taxRateSnapshot = settings.tax_enabled ? settings.tax_rate : 0;
        const taxTotal = settings.tax_enabled ? round2(taxableAmount * (taxRateSnapshot / 100)) : 0;
        const grandTotal = round2(taxableAmount + taxTotal);

        let amountPaid;
        let changeDue;
        if (paymentMethod === 'cash') {
          const tendered = Number(rawAmountPaid);
          if (!Number.isFinite(tendered) || round2(tendered) < grandTotal) {
            throw HttpError(
              400,
              `Cash tendered (${Number.isFinite(tendered) ? round2(tendered).toFixed(2) : '0.00'}) is less than grand total (${grandTotal.toFixed(2)})`
            );
          }
          amountPaid = round2(tendered);
          changeDue = round2(amountPaid - grandTotal);
        } else {
          // Never store sensitive card/bank details; record simulated exact settlement
          amountPaid = grandTotal;
          changeDue = 0;
        }

        const nowDate = new Date();
        const now = nowDate.toISOString();
        const receiptNumber = generateReceiptNumber(nowDate);

        const saleInfo = db.prepare(`
          INSERT INTO sales (
            receipt_number, idempotency_key, cashier_id, subtotal, discount_total,
            tax_rate_snapshot, tax_total, grand_total, payment_method,
            amount_paid, change_due, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
        `).run(
          receiptNumber,
          idempotencyKey,
          req.user.id,
          subtotal,
          discountTotal,
          taxRateSnapshot,
          taxTotal,
          grandTotal,
          paymentMethod,
          amountPaid,
          changeDue,
          now
        );

        const saleId = Number(saleInfo.lastInsertRowid);
        const insertItem = db.prepare(`
          INSERT INTO sale_items (
            sale_id, product_id, product_name_snapshot, sku_snapshot,
            unit_price, quantity, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const updateInv = db.prepare('UPDATE inventory SET quantity_available = ?, updated_at = ? WHERE product_id = ?');
        const insertMov = db.prepare(`
          INSERT INTO stock_movements (
            product_id, supplier_id, movement_type, quantity,
            previous_quantity, new_quantity, reason, reference, user_id, created_at
          ) VALUES (?, NULL, 'sale', ?, ?, ?, 'POS sale deduction', ?, ?, ?)
        `);

        for (const line of preparedLines) {
          insertItem.run(
            saleId,
            line.productId,
            line.name,
            line.sku,
            line.unitPrice,
            line.qty,
            line.lineTotal
          );
          updateInv.run(line.newQty, now, line.productId);
          insertMov.run(
            line.productId,
            -line.qty,
            line.prevQty,
            line.newQty,
            receiptNumber,
            req.user.id,
            now
          );
        }

        logAudit(db, {
          userId: req.user.id,
          action: 'SALE_COMPLETED',
          entityType: 'sale',
          entityId: saleId,
          details: `Completed sale ${receiptNumber} (${paymentMethod}) totaling ${grandTotal.toFixed(2)}`
        });

        return { ...getSaleDetailsById(saleId), duplicate: false };
      });

      return res.status(outcome.duplicate ? 200 : 201).json({
        sale: outcome.sale,
        items: outcome.items,
        store: settings,
        duplicate: outcome.duplicate
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/', auth, canSell, (req, res, next) => {
    try {
      const clauses = [];
      const params = [];

      // Cashiers can ONLY view their own transaction history
      if (req.user.role_name === 'cashier') {
        clauses.push('s.cashier_id = ?');
        params.push(req.user.id);
      } else if (req.query.cashier_id) {
        const cid = Number(req.query.cashier_id);
        if (Number.isInteger(cid)) {
          clauses.push('s.cashier_id = ?');
          params.push(cid);
        }
      }

      if (req.query.from) {
        clauses.push("date(s.created_at, 'localtime') >= ?");
        params.push(String(req.query.from));
      }

      if (req.query.to) {
        clauses.push("date(s.created_at, 'localtime') <= ?");
        params.push(String(req.query.to));
      }

      if (req.query.receipt_number) {
        clauses.push('LOWER(s.receipt_number) LIKE ?');
        params.push(`%${String(req.query.receipt_number).trim().toLowerCase()}%`);
      }

      if (req.query.payment_method && ['cash', 'card', 'transfer'].includes(req.query.payment_method)) {
        clauses.push('s.payment_method = ?');
        params.push(req.query.payment_method);
      }

      if (req.query.status && ['completed', 'voided'].includes(req.query.status)) {
        clauses.push('s.status = ?');
        params.push(req.query.status);
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const sales = db.prepare(`
        SELECT s.*,
               u.full_name AS cashier_name,
               v.full_name AS voided_by_name,
               (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
        FROM sales s
        JOIN users u ON u.id = s.cashier_id
        LEFT JOIN users v ON v.id = s.voided_by
        ${whereSql}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 250
      `).all(...params);

      return res.json({ sales });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:id', auth, canSell, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw HttpError(400, 'Invalid sale ID');

      const details = getSaleDetailsById(id);
      if (!details) throw HttpError(404, 'Sale record not found');

      if (req.user.role_name === 'cashier' && details.sale.cashier_id !== req.user.id) {
        throw HttpError(403, 'Access denied: cashiers can only view their own receipts');
      }

      return res.json({
        sale: details.sale,
        items: details.items,
        store: getSettingsMap(db)
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:id/void', auth, canVoid, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw HttpError(400, 'Invalid sale ID');

      const reason = String(req.body?.reason || '').trim();
      if (!reason) throw HttpError(400, 'A reason is required to void a sale');

      const now = new Date().toISOString();
      const result = withTransaction(db, () => {
        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
        if (!sale) throw HttpError(404, 'Sale record not found');
        if (sale.status === 'voided') throw HttpError(400, 'This sale has already been voided');

        db.prepare(`
          UPDATE sales
          SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ?
          WHERE id = ?
        `).run(reason, req.user.id, now, id);

        const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
        const selectInv = db.prepare('SELECT quantity_available FROM inventory WHERE product_id = ?');
        const updateInv = db.prepare('UPDATE inventory SET quantity_available = ?, updated_at = ? WHERE product_id = ?');
        const insertMov = db.prepare(`
          INSERT INTO stock_movements (
            product_id, supplier_id, movement_type, quantity,
            previous_quantity, new_quantity, reason, reference, user_id, created_at
          ) VALUES (?, NULL, 'void_return', ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of items) {
          const inv = selectInv.get(item.product_id);
          const prevQty = inv ? inv.quantity_available : 0;
          const newQty = prevQty + item.quantity;
          updateInv.run(newQty, now, item.product_id);
          insertMov.run(
            item.product_id,
            item.quantity,
            prevQty,
            newQty,
            `Voided sale ${sale.receipt_number}: ${reason}`,
            sale.receipt_number,
            req.user.id,
            now
          );
        }

        logAudit(db, {
          userId: req.user.id,
          action: 'SALE_VOIDED',
          entityType: 'sale',
          entityId: id,
          details: `Voided sale ${sale.receipt_number} (${sale.grand_total.toFixed(2)}). Reason: ${reason}`
        });

        return getSaleDetailsById(id);
      });

      return res.json({
        sale: result.sale,
        items: result.items,
        store: getSettingsMap(db)
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createSalesRouter;
