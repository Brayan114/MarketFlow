const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole, toSafeUser, HttpError } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

function createUsersRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const canManageUsers = requireRole('admin', 'manager');

  router.get('/roles', auth, canManageUsers, (req, res, next) => {
    try {
      const roles = db.prepare('SELECT id, name, display_name, description FROM roles ORDER BY id').all();
      return res.json({ roles });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/users', auth, canManageUsers, (req, res, next) => {
    try {
      const users = db.prepare(`
        SELECT u.id, u.full_name, u.email, u.role_id, u.status, u.created_at,
               r.name AS role_name, r.display_name AS role_display_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        ORDER BY u.id ASC
      `).all();
      return res.json({ users: users.map(toSafeUser) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/users', auth, canManageUsers, (req, res, next) => {
    try {
      const fullName = String(req.body?.full_name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const roleId = Number(req.body?.role_id);
      const status = req.body?.status === 'inactive' ? 'inactive' : 'active';

      if (!fullName) throw HttpError(400, 'Full name is required');
      if (!email || !email.includes('@')) throw HttpError(400, 'Valid email address is required');
      if (password.length < 6) throw HttpError(400, 'Password must be at least 6 characters');
      if (!Number.isInteger(roleId)) throw HttpError(400, 'Valid role is required');

      const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
      if (!role) throw HttpError(400, 'Selected role does not exist');

      if (role.name === 'admin' && req.user.role_name !== 'admin') {
        throw HttpError(403, 'Only a System Administrator can assign the Admin role');
      }

      const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
      if (existing) {
        throw HttpError(409, 'A staff account with this email already exists');
      }

      const passwordHash = bcrypt.hashSync(password, 10);
      const info = db.prepare(`
        INSERT INTO users (full_name, email, password_hash, role_id, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(fullName, email, passwordHash, roleId, status);

      const created = db.prepare(`
        SELECT u.id, u.full_name, u.email, u.role_id, u.status, u.created_at,
               r.name AS role_name, r.display_name AS role_display_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
      `).get(Number(info.lastInsertRowid));

      logAudit(db, {
        userId: req.user.id,
        action: 'USER_CREATED',
        entityType: 'user',
        entityId: created.id,
        details: `Created user ${created.full_name} (${created.email}) as ${created.role_display_name}`
      });

      return res.status(201).json({ user: toSafeUser(created) });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/users/:id', auth, canManageUsers, (req, res, next) => {
    try {
      const targetId = Number(req.params.id);
      if (!Number.isInteger(targetId)) throw HttpError(400, 'Invalid user ID');

      const existing = db.prepare(`
        SELECT u.*, r.name AS role_name, r.display_name AS role_display_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
      `).get(targetId);
      if (!existing) throw HttpError(404, 'Staff account not found');

      if (existing.role_name === 'admin' && req.user.role_name !== 'admin') {
        throw HttpError(403, 'Only a System Administrator can modify an Admin account');
      }

      const fullName = req.body?.full_name !== undefined
        ? String(req.body.full_name).trim()
        : existing.full_name;
      if (!fullName) throw HttpError(400, 'Full name cannot be empty');

      const status = req.body?.status !== undefined ? String(req.body.status) : existing.status;
      if (!['active', 'inactive'].includes(status)) {
        throw HttpError(400, 'Status must be active or inactive');
      }
      if (targetId === req.user.id && status === 'inactive') {
        throw HttpError(400, 'You cannot deactivate your own account while signed in');
      }

      let roleId = existing.role_id;
      let newRoleName = existing.role_name;
      if (req.body?.role_id !== undefined) {
        roleId = Number(req.body.role_id);
        const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
        if (!role) throw HttpError(400, 'Selected role does not exist');
        if (role.name === 'admin' && req.user.role_name !== 'admin') {
          throw HttpError(403, 'Only a System Administrator can assign the Admin role');
        }
        newRoleName = role.name;
      }

      let passwordHash = existing.password_hash;
      let passwordReset = false;
      if (req.body?.password !== undefined && String(req.body.password) !== '') {
        const pwd = String(req.body.password);
        if (pwd.length < 6) throw HttpError(400, 'New password must be at least 6 characters');
        passwordHash = bcrypt.hashSync(pwd, 10);
        passwordReset = true;
      }

      db.prepare(`
        UPDATE users
        SET full_name = ?, role_id = ?, status = ?, password_hash = ?
        WHERE id = ?
      `).run(fullName, roleId, status, passwordHash, targetId);

      const updated = db.prepare(`
        SELECT u.id, u.full_name, u.email, u.role_id, u.status, u.created_at,
               r.name AS role_name, r.display_name AS role_display_name
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
      `).get(targetId);

      const changes = [];
      if (fullName !== existing.full_name) changes.push(`name -> ${fullName}`);
      if (roleId !== existing.role_id) changes.push(`role -> ${newRoleName}`);
      if (status !== existing.status) changes.push(`status -> ${status}`);
      if (passwordReset) changes.push('password reset');

      logAudit(db, {
        userId: req.user.id,
        action: status !== existing.status ? 'USER_STATUS_CHANGED' : 'USER_UPDATED',
        entityType: 'user',
        entityId: targetId,
        details: changes.length ? `Updated ${updated.full_name}: ${changes.join(', ')}` : `Updated ${updated.full_name}`
      });

      return res.json({ user: toSafeUser(updated) });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createUsersRouter;
