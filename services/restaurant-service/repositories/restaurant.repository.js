const { getPool } = require('../config/database');

const PUBLIC_COLUMNS = `id, owner_user_id, name, description, address, contact_number,
  email, cuisine_type, opening_time, closing_time, status, operating_status,
  created_at, updated_at`;

async function create(input) {
  const [result] = await getPool().execute(
    `INSERT INTO restaurants
     (owner_user_id, name, description, address, contact_number, email, cuisine_type, opening_time, closing_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.ownerUserId, input.name, input.description ?? null, input.address,
      input.contactNumber, input.email, input.cuisineType,
      input.openingTime ?? null, input.closingTime ?? null],
  );
  return findById(result.insertId);
}

async function listPublic({ page, limit, cuisine, operatingStatus }) {
  const filters = ['status = \'ACTIVE\''];
  const values = [];
  if (cuisine) { filters.push('cuisine_type = ?'); values.push(cuisine); }
  if (operatingStatus) { filters.push('operating_status = ?'); values.push(operatingStatus); }
  return listWhere(filters.join(' AND '), values, page, limit);
}

async function listMine(ownerUserId, page, limit) {
  return listWhere('owner_user_id = ?', [ownerUserId], page, limit);
}

async function listAll(page, limit) {
  return listWhere('1 = 1', [], page, limit);
}

async function listWhere(where, values, page, limit) {
  const offset = (page - 1) * limit;
  const [rows] = await getPool().execute(
    `SELECT ${PUBLIC_COLUMNS} FROM restaurants WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  const [counts] = await getPool().execute(
    `SELECT COUNT(*) AS total FROM restaurants WHERE ${where}`,
    values,
  );
  return { restaurants: rows, page, limit, total: Number(counts[0].total) };
}

async function findById(id) {
  const [rows] = await getPool().execute(
    `SELECT ${PUBLIC_COLUMNS} FROM restaurants WHERE id = ? LIMIT 1`, [id],
  );
  return rows[0] || null;
}

async function findOwned(id, ownerUserId) {
  const [rows] = await getPool().execute(
    `SELECT ${PUBLIC_COLUMNS} FROM restaurants WHERE id = ? AND owner_user_id = ? LIMIT 1`,
    [id, ownerUserId],
  );
  return rows[0] || null;
}

async function update(id, input) {
  const columns = {
    name: 'name', description: 'description', address: 'address',
    contactNumber: 'contact_number', email: 'email', cuisineType: 'cuisine_type',
    openingTime: 'opening_time', closingTime: 'closing_time',
  };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const sets = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
  const [result] = await getPool().execute(
    `UPDATE restaurants SET ${sets} WHERE id = ?`,
    [...entries.map(([, value]) => value), id],
  );
  return findById(id);
}

async function setStatus(id, status) {
  await getPool().execute('UPDATE restaurants SET status = ? WHERE id = ?', [status, id]);
  return findById(id);
}

async function setOperatingStatus(id, operatingStatus) {
  await getPool().execute(
    'UPDATE restaurants SET operating_status = ? WHERE id = ?', [operatingStatus, id],
  );
  return findById(id);
}

async function deactivate(id) {
  const [result] = await getPool().execute(
    "UPDATE restaurants SET status = 'INACTIVE' WHERE id = ? AND status <> 'INACTIVE'", [id],
  );
  return result.affectedRows > 0;
}

module.exports = { create, listPublic, listMine, listAll, findById, findOwned, update, setStatus, setOperatingStatus, deactivate };