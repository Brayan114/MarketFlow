function HttpError(status, message, details) {
  const err = new Error(message);
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function toSafeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role_id: row.role_id,
    role_name: row.role_name,
    role_display_name: row.role_display_name,
    status: row.status,
    created_at: row.created_at
  };
}

function requireAuth(db) {
  const getUserStmt = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.role_id, u.status, u.created_at,
           r.name AS role_name, r.display_name AS role_display_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `);

  return (req, res, next) => {
    const userId = req.session && req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const row = getUserStmt.get(userId);
    if (!row || row.status !== 'active') {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(401).json({ error: 'Session is invalid or account is deactivated' });
    }
    req.user = toSafeUser(row);
    return next();
  };
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role_name)) {
      return res.status(403).json({
        error: `Access denied: ${req.user.role_display_name} cannot perform this action`
      });
    }
    return next();
  };
}

module.exports = {
  HttpError,
  toSafeUser,
  requireAuth,
  requireRole
};
