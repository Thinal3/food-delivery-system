const mysql = require('mysql2/promise');
const { database } = require('./env');

let pool;

function getPool() {
  // Reuse one lazy pool; mysql2 opens and reuses connections as queries arrive.
  if (!pool) pool = mysql.createPool(database);
  return pool;
}

async function checkDatabase() {
  // Creating a pool does not connect, so run a query to verify database readiness.
  await getPool().query('SELECT 1');
}

async function closePool() {
  if (!pool) return;
  // Drain and close pooled connections during graceful process shutdown.
  await pool.end();
  pool = undefined;
}

module.exports = { getPool, checkDatabase, closePool };