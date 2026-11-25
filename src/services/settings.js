function getSettingsMap(db) {
  const rows = db.prepare('SELECT key, value FROM store_settings').all();
  const raw = {};
  for (const row of rows) {
    raw[row.key] = row.value;
  }
  return {
    store_name: raw.store_name || 'MarketFlow Supermarket',
    store_address: raw.store_address || '',
    store_phone: raw.store_phone || '',
    currency_symbol: raw.currency_symbol || '$',
    tax_enabled: raw.tax_enabled === 'true',
    tax_rate: Number.isFinite(Number(raw.tax_rate)) ? Number(raw.tax_rate) : 0,
    receipt_footer: raw.receipt_footer || '',
    max_cashier_discount_percent: Number.isFinite(Number(raw.max_cashier_discount_percent))
      ? Number(raw.max_cashier_discount_percent)
      : 10
  };
}

module.exports = { getSettingsMap };
