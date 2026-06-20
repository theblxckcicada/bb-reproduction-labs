const db = require('../src/db');

db.resetDb();
console.log(`Reset ${db.dbPath}`);
