const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { sessionMiddleware } = require('./middleware/session');

const createAuthRouter = require('./routes/auth');
const createUsersRouter = require('./routes/users');
const createCategoriesRouter = require('./routes/categories');
const createProductsRouter = require('./routes/products');
const createSuppliersRouter = require('./routes/suppliers');
const createInventoryRouter = require('./routes/inventory');
const createSalesRouter = require('./routes/sales');
const createReportsRouter = require('./routes/reports');
const createAuditRouter = require('./routes/audit');
const createSettingsRouter = require('./routes/settings');

function createApp(db, expressLib = express) {
  const app = expressLib();
  const rootDir = fs.existsSync(path.join(__dirname, '..', 'package.json'))
    ? path.join(__dirname, '..')
    : process.cwd();

  app.set('trust proxy', 1);
  app.use(expressLib.json({ limit: '1mb' }));
  app.use(sessionMiddleware());

  // Serve public assets (includes offline vendor assets under public/vendor/)
  app.use(expressLib.static(path.join(rootDir, 'public')));

  app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', app: 'MarketFlow' });
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api', createUsersRouter(db));
  app.use('/api/categories', createCategoriesRouter(db));
  app.use('/api/products', createProductsRouter(db));
  app.use('/api/suppliers', createSuppliersRouter(db));
  app.use('/api/inventory', createInventoryRouter(db));
  app.use('/api/sales', createSalesRouter(db));
  app.use('/api/reports', createReportsRouter(db));
  app.use('/api/audit-logs', createAuditRouter(db));
  app.use('/api/settings', createSettingsRouter(db));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  app.get('/', (req, res) => {
    const indexPath = path.join(rootDir, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    return res.redirect(302, '/index.html');
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    if (status >= 500) {
      console.error('[Server Error]', err);
      return res.status(500).json({ error: 'An unexpected server error occurred' });
    }
    return res.status(status).json({ error: err.message || 'Request failed' });
  });

  return app;
}

module.exports = { createApp };
