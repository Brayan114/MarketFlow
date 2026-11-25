const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

function createAuditRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const managersOnly = requireRole('admin', 'manager');

  router.get('/', auth, managersOnly, (req, res, next) => {
    try {
      const clauses = [];
      const params = [];

      if (req.query.action) {
        clauses.push('al.action = ?');
        params.push(String(req.query.action));
      }
      if (req.query.entity_type) {
        clauses.push('al.entity_type = ?');
        params.push(String(req.query.entity_type));
      }
      if (req.query.user_id) {
        const uid = Number(req.query.user_id);
        if (Number.isInteger(uid)) {
          clauses.push('al.user_id = ?');
          params.push(uid);
        }
      }
      if (req.query.from) {
        clauses.push("date(al.created_at, 'localtime') >= ?");
        params.push(String(req.query.from));
      }
      if (req.query.to) {
        clauses.push("date(al.created_at, 'localtime') <= ?");
        params.push(String(req.query.to));
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const logs = db.prepare(`
        SELECT al.*, COALESCE(u.full_name, 'System') AS user_name, COALESCE(r.display_name, '') AS role_display_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        LEFT JOIN roles r ON r.id = u.role_id
        ${whereSql}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT 250
      `).all(...params);

      return res.json({ logs });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createAuditRouter;
