const express = require('express');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

function createCategoriesRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const canEdit = requireRole('admin', 'manager', 'inventory_officer');

  router.get('/', auth, (req, res, next) => {
    try {
      const categories = db.prepare(`
        SELECT c.*,
               (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
        FROM categories c
        ORDER BY c.name ASC
      `).all();
      return res.json({ categories });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', auth, canEdit, (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      const description = String(req.body?.description || '').trim();
      if (!name) throw HttpError(400, 'Category name is required');

      const dup = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
      if (dup) throw HttpError(409, 'A category with this name already exists');

      const info = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(name, description);
      const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(info.lastInsertRowid));

      logAudit(db, {
        userId: req.user.id,
        action: 'CATEGORY_CREATED',
        entityType: 'category',
        entityId: category.id,
        details: `Created category "${category.name}"`
      });

      return res.status(201).json({ category });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/:id', auth, canEdit, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw HttpError(400, 'Invalid category ID');

      const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
      if (!existing) throw HttpError(404, 'Category not found');

      const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
      const description = req.body?.description !== undefined
        ? String(req.body.description).trim()
        : existing.description;

      if (!name) throw HttpError(400, 'Category name cannot be empty');

      const dup = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?').get(name, id);
      if (dup) throw HttpError(409, 'Another category already uses this name');

      db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(name, description, id);
      const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);

      logAudit(db, {
        userId: req.user.id,
        action: 'CATEGORY_UPDATED',
        entityType: 'category',
        entityId: id,
        details: `Updated category "${category.name}"`
      });

      return res.json({ category });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createCategoriesRouter;
