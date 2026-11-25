const express = require('express');
const { round2 } = require('../../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

function toLocalYMD(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftLocalDays(daysAgo) {
  const now = new Date();
  return toLocalYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo));
}

function createReportsRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const managersOnly = requireRole('admin', 'manager');

  router.get('/dashboard', auth, managersOnly, (req, res, next) => {
    try {
      const today = toLocalYMD();
      const sevenDaysAgo = shiftLocalDays(6);

      const todayRow = db.prepare(`
        SELECT COALESCE(SUM(grand_total), 0) AS sales_today,
               COUNT(*) AS transactions_today
        FROM sales
        WHERE status = 'completed'
          AND date(created_at, 'localtime') = ?
      `).get(today);

      const stockCounts = db.prepare(`
        SELECT
          SUM(CASE WHEN p.active = 1 THEN 1 ELSE 0 END) AS active_products_count,
          SUM(CASE WHEN p.active = 1 AND COALESCE(i.quantity_available, 0) <= p.reorder_level THEN 1 ELSE 0 END) AS low_stock_count,
          SUM(CASE WHEN p.active = 1 AND COALESCE(i.quantity_available, 0) = 0 THEN 1 ELSE 0 END) AS out_of_stock_count
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.id
      `).get();

      const seriesRows = db.prepare(`
        SELECT date(created_at, 'localtime') AS day,
               COALESCE(SUM(grand_total), 0) AS revenue,
               COUNT(*) AS transactions
        FROM sales
        WHERE status = 'completed'
          AND date(created_at, 'localtime') >= ?
        GROUP BY date(created_at, 'localtime')
        ORDER BY day ASC
      `).all(sevenDaysAgo);

      const seriesMap = new Map(seriesRows.map((r) => [r.day, r]));
      const dailySeries = [];
      for (let i = 6; i >= 0; i -= 1) {
        const day = shiftLocalDays(i);
        const found = seriesMap.get(day);
        dailySeries.push({
          day,
          revenue: found ? round2(found.revenue) : 0,
          transactions: found ? found.transactions : 0
        });
      }

      const lowStockProducts = db.prepare(`
        SELECT p.id, p.name, p.sku, p.unit, p.reorder_level,
               c.name AS category_name,
               COALESCE(i.quantity_available, 0) AS quantity_available
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN inventory i ON i.product_id = p.id
        WHERE p.active = 1 AND COALESCE(i.quantity_available, 0) <= p.reorder_level
        ORDER BY (COALESCE(i.quantity_available, 0) - p.reorder_level) ASC, p.name ASC
        LIMIT 10
      `).all();

      const thirtyDaysAgo = shiftLocalDays(29);
      const topProducts = db.prepare(`
        SELECT si.product_id,
               MAX(si.product_name_snapshot) AS product_name,
               MAX(si.sku_snapshot) AS sku,
               SUM(si.quantity) AS units_sold,
               ROUND(SUM(si.line_total), 2) AS revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.status = 'completed'
          AND date(s.created_at, 'localtime') >= ?
        GROUP BY si.product_id
        ORDER BY units_sold DESC, revenue DESC
        LIMIT 5
      `).all(thirtyDaysAgo);

      const recentSales = db.prepare(`
        SELECT s.id, s.receipt_number, s.grand_total, s.payment_method, s.status, s.created_at,
               u.full_name AS cashier_name
        FROM sales s
        JOIN users u ON u.id = s.cashier_id
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 8
      `).all();

      return res.json({
        kpis: {
          sales_today: round2(todayRow.sales_today || 0),
          transactions_today: todayRow.transactions_today || 0,
          low_stock_count: stockCounts.low_stock_count || 0,
          out_of_stock_count: stockCounts.out_of_stock_count || 0,
          active_products_count: stockCounts.active_products_count || 0
        },
        daily_series: dailySeries,
        low_stock_products: lowStockProducts,
        top_products: topProducts,
        recent_sales: recentSales
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/sales', auth, managersOnly, (req, res, next) => {
    try {
      const period = String(req.query.period || 'weekly');
      const today = toLocalYMD();
      let from = req.query.from ? String(req.query.from) : '';
      let to = req.query.to ? String(req.query.to) : '';

      if (!from && !to) {
        to = today;
        if (period === 'daily') {
          from = today;
        } else if (period === 'monthly') {
          from = shiftLocalDays(29);
        } else {
          from = shiftLocalDays(6);
        }
      }

      const clauses = [];
      const params = [];

      if (from) {
        clauses.push("date(s.created_at, 'localtime') >= ?");
        params.push(from);
      }
      if (to) {
        clauses.push("date(s.created_at, 'localtime') <= ?");
        params.push(to);
      }
      if (req.query.cashier_id) {
        const cid = Number(req.query.cashier_id);
        if (Number.isInteger(cid)) {
          clauses.push('s.cashier_id = ?');
          params.push(cid);
        }
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const completedWhereSql = clauses.length
        ? `WHERE s.status = 'completed' AND ${clauses.join(' AND ')}`
        : "WHERE s.status = 'completed'";

      const summary = db.prepare(`
        SELECT
          SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END) AS voided_count,
          COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.subtotal ELSE 0 END), 0) AS gross_subtotal,
          COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.discount_total ELSE 0 END), 0) AS discount_total,
          COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.tax_total ELSE 0 END), 0) AS tax_total,
          COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.grand_total ELSE 0 END), 0) AS net_revenue
        FROM sales s
        ${whereSql}
      `).get(...params);

      const byPaymentMethod = db.prepare(`
        SELECT s.payment_method,
               COUNT(*) AS transactions,
               ROUND(COALESCE(SUM(s.grand_total), 0), 2) AS total_amount
        FROM sales s
        ${completedWhereSql}
        GROUP BY s.payment_method
        ORDER BY total_amount DESC
      `).all(...params);

      const byCashier = db.prepare(`
        SELECT u.id AS cashier_id,
               u.full_name AS cashier_name,
               COUNT(*) AS transactions,
               ROUND(COALESCE(SUM(s.grand_total), 0), 2) AS total_amount
        FROM sales s
        JOIN users u ON u.id = s.cashier_id
        ${completedWhereSql}
        GROUP BY u.id, u.full_name
        ORDER BY total_amount DESC
      `).all(...params);

      const periodExpr = period === 'monthly'
        ? "strftime('%Y-%m', s.created_at, 'localtime')"
        : "date(s.created_at, 'localtime')";

      const byPeriod = db.prepare(`
        SELECT ${periodExpr} AS label,
               COUNT(*) AS transactions,
               ROUND(COALESCE(SUM(s.subtotal), 0), 2) AS subtotal,
               ROUND(COALESCE(SUM(s.discount_total), 0), 2) AS discount_total,
               ROUND(COALESCE(SUM(s.tax_total), 0), 2) AS tax_total,
               ROUND(COALESCE(SUM(s.grand_total), 0), 2) AS net_revenue
        FROM sales s
        ${completedWhereSql}
        GROUP BY ${periodExpr}
        ORDER BY label ASC
      `).all(...params);

      const transactions = db.prepare(`
        SELECT s.id, s.receipt_number, s.subtotal, s.discount_total, s.tax_total,
               s.grand_total, s.payment_method, s.status, s.created_at,
               u.full_name AS cashier_name
        FROM sales s
        JOIN users u ON u.id = s.cashier_id
        ${whereSql}
        ORDER BY s.created_at DESC, s.id DESC
      `).all(...params);

      return res.json({
        filters: { period, from, to, cashier_id: req.query.cashier_id || null },
        summary: {
          completed_count: summary.completed_count || 0,
          voided_count: summary.voided_count || 0,
          gross_subtotal: round2(summary.gross_subtotal || 0),
          discount_total: round2(summary.discount_total || 0),
          tax_total: round2(summary.tax_total || 0),
          net_revenue: round2(summary.net_revenue || 0)
        },
        by_payment_method: byPaymentMethod,
        by_cashier: byCashier,
        by_period: byPeriod,
        transactions
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/top-products', auth, managersOnly, (req, res, next) => {
    try {
      const clauses = ["s.status = 'completed'"];
      const params = [];

      if (req.query.from) {
        clauses.push("date(s.created_at, 'localtime') >= ?");
        params.push(String(req.query.from));
      }
      if (req.query.to) {
        clauses.push("date(s.created_at, 'localtime') <= ?");
        params.push(String(req.query.to));
      }

      const products = db.prepare(`
        SELECT si.product_id,
               MAX(si.product_name_snapshot) AS product_name,
               MAX(si.sku_snapshot) AS sku,
               COALESCE(c.name, 'Uncategorized') AS category_name,
               SUM(si.quantity) AS units_sold,
               ROUND(SUM(si.line_total), 2) AS revenue,
               COUNT(DISTINCT si.sale_id) AS order_appearances
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${clauses.join(' AND ')}
        GROUP BY si.product_id
        ORDER BY units_sold DESC, revenue DESC
      `).all(...params);

      return res.json({ products });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/inventory', auth, managersOnly, (req, res, next) => {
    try {
      const items = db.prepare(`
        SELECT p.id, p.name, p.sku, p.unit, p.selling_price, p.cost_price,
               p.reorder_level, p.active,
               c.name AS category_name,
               COALESCE(i.quantity_available, 0) AS quantity_available,
               ROUND(COALESCE(i.quantity_available, 0) * p.selling_price, 2) AS retail_value,
               ROUND(COALESCE(i.quantity_available, 0) * p.cost_price, 2) AS cost_value
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN inventory i ON i.product_id = p.id
        ORDER BY p.active DESC, (COALESCE(i.quantity_available, 0) - p.reorder_level) ASC, p.name ASC
      `).all().map((row) => ({
        ...row,
        stock_status: row.quantity_available <= 0
          ? 'out_of_stock'
          : (row.quantity_available <= row.reorder_level ? 'low_stock' : 'healthy')
      }));

      const activeItems = items.filter((item) => item.active === 1);
      const summary = {
        total_skus: items.length,
        active_skus: activeItems.length,
        total_units: activeItems.reduce((sum, item) => sum + item.quantity_available, 0),
        total_retail_value: round2(activeItems.reduce((sum, item) => sum + item.retail_value, 0)),
        total_cost_value: round2(activeItems.reduce((sum, item) => sum + item.cost_value, 0)),
        low_stock_count: activeItems.filter((item) => item.stock_status !== 'healthy').length,
        out_of_stock_count: activeItems.filter((item) => item.stock_status === 'out_of_stock').length
      };

      const byCategory = db.prepare(`
        SELECT c.name AS category_name,
               COUNT(p.id) AS product_count,
               COALESCE(SUM(i.quantity_available), 0) AS total_units,
               ROUND(COALESCE(SUM(COALESCE(i.quantity_available, 0) * p.selling_price), 0), 2) AS retail_value
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
        LEFT JOIN inventory i ON i.product_id = p.id
        GROUP BY c.id, c.name
        ORDER BY retail_value DESC
      `).all();

      return res.json({ summary, by_category: byCategory, items });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = createReportsRouter;
