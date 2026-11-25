const express = require('express');
const { withTransaction } = require('../../db/database');
const { requireAuth, requireRole, HttpError } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { getSettingsMap } = require('../services/settings');

function createSettingsRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const managersOnly = requireRole('admin', 'manager');

  router.get('/', auth, (req, res, next) => {
    try {
      return res.json({ settings: getSettingsMap(db) });
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/', auth, managersOnly, (req, res, next) => {
    try {
      const current = getSettingsMap(db);
      const nextValues = {
        store_name: req.body?.store_name !== undefined
          ? String(req.body.store_name).trim()
          : current.store_name,
        store_address: req.body?.store_address !== undefined
          ? String(req.body.store_address).trim()
          : current.store_address,
        store_phone: req.body?.store_phone !== undefined
          ? String(req.body.store_phone).trim()
          : current.store_phone,
        currency_symbol: req.body?.currency_symbol !== undefined
          ? String(req.body.currency_symbol).trim()
          : current.currency_symbol,
        tax_enabled: req.body?.tax_enabled !== undefined
          ? String(Boolean(req.body.tax_enabled))
          : String(current.tax_enabled),
        tax_rate: req.body?.tax_rate !== undefined
          ? Number(req.body.tax_rate)
          : current.tax_rate,
        receipt_footer: req.body?.receipt_footer !== undefined
          ? String(req.body.receipt_footer).trim()
          : current.receipt_footer,
        max_cashier_discount_percent: req.body?.max_cashier_discount_percent !== undefined
          ? Number(req.body.max_cashier_discount_percent)
          : current.max_cashier_discount_percent
      };

      if (!nextValues.store_name) throw HttpError(400, 'Store name cannot be empty');
      if (!nextValues.currency_symbol) throw HttpError(400, 'Currency symbol cannot be empty');
      if (!Number.isFinite(nextValues.tax_rate) || nextValues.tax_rate < 0 || nextValues.tax_rate > 50) {
        throw HttpError(400, 'Tax rate must be between 0 and 50%');
      }
      if (
        !Number.isFinite(nextValues.max_cashier_discount_percent) ||
        nextValues.max_cashier_discount_percent < 0 ||
        nextValues.max_cashier_discount_percent > 100
      ) {
        throw HttpError(400, 'Max cashier discount must be between 0 and 100%');
      }

      withTransaction(db, () => {
        const upsert = db.prepare(`
          INSERT INTO store_settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        for (const [k, v] of Object.entries(nextValues)) {
          upsert.run(k, String(v));
        }

        logAudit(db, {
          userId: req.user.id,
          action: 'SETTINGS_UPDATED',
          entityType: 'settings',
          entityId: 'store',
          details: `Updated store settings (Tax: ${nextValues.tax_enabled === 'true' ? `${nextValues.tax_rate}%` : 'Disabled'}, Currency: ${nextValues.currency_symbol})`
        });
      });

      return res.json({ settings: getSettingsMap(db) });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createSettingsRouter;
