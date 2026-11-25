const { initDatabase } = require('./db/database');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const db = initDatabase();
const app = createApp(db);

const server = app.listen(PORT, () => {
  console.log(`MarketFlow server running at http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch (_) {
      // ignore
    }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
