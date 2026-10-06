const { getPool } = require('../config/database');

const CUSTOMER_COLUMNS = `id, user_id, first_name, last_name, phone_number,
  profile_image, status, created_at, updated_at`;

async function findByUserId(userId) {
  const [rows] = await getPool().execute(
    `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE user_id = ? LIMIT 1`, [userId],
  );
  return rows[0] || null;
}

async function findById(customerId) {
  const [rows] = await getPool().execute(
    `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = ? LIMIT 1`, [customerId],
  );
  return rows[0] || null;
}

async function create(userId, input) {
  const [result] = await getPool().execute(
    `INSERT INTO customers (user_id, first_name, last_name, phone_number, profile_image)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, input.firstName, input.lastName, input.phoneNumber, input.profileImage ?? null],
  );
  return findById(result.insertId);
}

async function updateByUserId(userId, input) {
  const columns = { firstName: 'first_name', lastName: 'last_name', phoneNumber: 'phone_number', profileImage: 'profile_image' };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const setClause = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
  await getPool().execute(
    `UPDATE customers SET ${setClause} WHERE user_id = ? AND status = 'ACTIVE'`,
    [...entries.map(([, value]) => value), userId],
  );
  return findByUserId(userId);
}

async function list(page, limit) {
  const offset = (page - 1) * limit;
  const [rows] = await getPool().execute(
    `SELECT ${CUSTOMER_COLUMNS} FROM customers ORDER BY id LIMIT ? OFFSET ?`, [limit, offset],
  );
  const [counts] = await getPool().query('SELECT COUNT(*) AS total FROM customers');
  return { customers: rows, page, limit, total: Number(counts[0].total) };
}

async function setStatus(customerId, status) {
  await getPool().execute('UPDATE customers SET status = ? WHERE id = ?', [status, customerId]);
  return findById(customerId);
}

async function lockActiveByUserId(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT id, user_id, status FROM customers WHERE user_id = ? FOR UPDATE`, [userId],
  );
  return rows[0] || null;
}

module.exports = { findByUserId, findById, create, updateByUserId, list, setStatus, lockActiveByUserId };