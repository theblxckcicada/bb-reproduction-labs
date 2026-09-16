'use strict';

const db = require('../src/db');
db.resetDatabase();
console.log(`Reset ${db.dbPath}`);
