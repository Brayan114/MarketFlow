const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, toSafeUser } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/login', (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const row = db.prepare(`
        SELECT u.*, r.name AS role_name, r.display_name AS role_display_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE LOWER(u.email) = ?
      `).get(email);

      if (!row || !bcrypt.compareSync(password, row.password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (row.status !== 'active') {
        return res.status(403).json({ error: 'Your account has been deactivated. Contact an administrator.' });
      }

      req.session.setUser(row.id);

      logAudit(db, {
        userId: row.id,
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: row.id,
        details: `${row.full_name} (${row.role_name}) signed in`
      });

      return res.json({ user: toSafeUser(row) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', (req, res, next) => {
    try {
      const userId = req.session?.userId || null;
      if (userId) {
        logAudit(db, {
          userId,
          action: 'USER_LOGOUT',
          entityType: 'user',
          entityId: userId,
          details: 'User signed out'
        });
      }
      req.session.destroy((err) => {
        if (err) return next(err);
        return res.json({ ok: true });
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', requireAuth(db), (req, res) => {
    return res.json({ user: req.user });
  });

  return router;
}

module.exports = createAuthRouter;
