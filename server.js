const { initDatabase } = require('./db/database');
const { createApp } = require('./src/createApp');

const db = initDatabase();
const app = createApp(db);

if (require.main === module && !process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 3000;
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
}

module.exports = app;
