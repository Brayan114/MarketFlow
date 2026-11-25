function logAudit(db, { userId = null, action, entityType, entityId = null, details = '' }) {
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, action, entityType, entityId === null || entityId === undefined ? null : String(entityId), details);
}

module.exports = { logAudit };
