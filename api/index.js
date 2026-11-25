const { initDatabase } = require('../db/database');
const { createApp } = require('../src/app');

let cachedApp = null;

function getApp() {
  if (!cachedApp) {
    const db = initDatabase();
    cachedApp = createApp(db);
  }
  return cachedApp;
}

module.exports = (req, res) => {
  return getApp()(req, res);
};
