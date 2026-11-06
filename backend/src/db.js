const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, '..', 'booking.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

module.exports = db;
// On hosts with a disk that resets on restart (e.g. Render free), set AUTO_SEED=1 to refill demo data.
if (process.env.AUTO_SEED) require('./seed');
