const express = require('express');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

function createSuppliersRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const canAccess = requireRole('admin', 'manager', 'inventory_officer');

  router.get('/', auth, canAccess, (req, res, next) => {
    try {
      const suppliers = db.prepare(`
        SELECT s.*,
               (SELECT COUNT(*) FROM stock_movements sm WHERE sm.supplier_id = s.id) AS delivery_count
        FROM suppliers s
        ORDER BY s.name ASC
      `).all();
      return res.json({ suppliers });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', auth, canAccess, (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      const contactPerson = String(req.body?.contact_person || '').trim();
      const phone = String(req.body?.phone || '').trim();
      const email = String(req.body?.email || '').trim();
      const address = String(req.body?.address || '').trim();

      if (!name) throw HttpError(400, 'Supplier company name is required');

      const info = db.prepare(`
        INSERT INTO suppliers (name, contact_person, phone, email, address)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, contactPerson, phone, email, address);

      const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(info.lastInsertRowid));

      logAudit(db, {
        userId: req.user.id,
        action: 'SUPPLIER_CREATED',
        entityType: 'supplier',
        entityId: supplier.id,
        details: `Added supplier "${supplier.name}"`
      });

      return res.status(201).json({ supplier });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/:id', auth, canAccess, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw HttpError(400, 'Invalid supplier ID');

      const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
      if (!existing) throw HttpError(404, 'Supplier not found');

      const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
      const contactPerson = req.body?.contact_person !== undefined
        ? String(req.body.contact_person).trim()
        : existing.contact_person;
      const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : existing.phone;
      const email = req.body?.email !== undefined ? String(req.body.email).trim() : existing.email;
      const address = req.body?.address !== undefined ? String(req.body.address).trim() : existing.address;

      if (!name) throw HttpError(400, 'Supplier company name cannot be empty');

      db.prepare(`
        UPDATE suppliers
        SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?
        WHERE id = ?
      `).run(name, contactPerson, phone, email, address, id);

      const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);

      logAudit(db, {
        userId: req.user.id,
        action: 'SUPPLIER_UPDATED',
        entityType: 'supplier',
        entityId: id,
        details: `Updated supplier "${supplier.name}"`
      });

      return res.json({ supplier });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createSuppliersRouter;
