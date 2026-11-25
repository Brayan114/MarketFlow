const fs = require('node:fs');
const { DEFAULT_DB_PATH, initDatabase } = require('./database');

const targetPath = process.env.DB_PATH || DEFAULT_DB_PATH;

for (const suffix of ['', '-wal', '-shm']) {
  const file = `${targetPath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

const db = initDatabase(targetPath);
db.close();
console.log(`MarketFlow database reset and seeded at: ${targetPath}`);
