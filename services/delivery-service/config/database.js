const mysql = require('mysql2/promise');
const { database } = require('./env');

let pool;
function getPool() {
  if (!pool) pool = mysql.createPool(database);
  return pool;
}
async function checkDatabase() { await getPool().query('SELECT 1'); }
async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}

module.exports = { getPool, checkDatabase, closePool };