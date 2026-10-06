const { getPool } = require('../config/database');

const ADDRESS_COLUMNS = `id, customer_id, address_name, address_line1, address_line2,
  city, postal_code, latitude, longitude, is_default, created_at, updated_at`;

async function list(customerId) {
  const [rows] = await getPool().execute(
    `SELECT ${ADDRESS_COLUMNS} FROM customer_addresses
     WHERE customer_id = ? ORDER BY is_default DESC, id`, [customerId],
  );
  return rows;
}

async function findById(customerId, addressId) {
  const [rows] = await getPool().execute(
    `SELECT ${ADDRESS_COLUMNS} FROM customer_addresses
     WHERE customer_id = ? AND id = ? LIMIT 1`, [customerId, addressId],
  );
  return rows[0] || null;
}

async function create(customerId, input) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute(
      "SELECT id FROM customers WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [customerId],
    );
    if (!customers.length) { await connection.rollback(); return { customerInactive: true }; }
    const [existing] = await connection.execute(
      'SELECT id FROM customer_addresses WHERE customer_id = ? ORDER BY id LIMIT 1 FOR UPDATE', [customerId],
    );
    const makeDefault = input.isDefault || existing.length === 0;
    if (makeDefault) {
      await connection.execute('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
    }
    const [result] = await connection.execute(
      `INSERT INTO customer_addresses
       (customer_id, address_name, address_line1, address_line2, city, postal_code, latitude, longitude, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, input.addressName, input.addressLine1, input.addressLine2 ?? null,
        input.city, input.postalCode, input.latitude ?? null, input.longitude ?? null, makeDefault],
    );
    const [rows] = await connection.execute(
      `SELECT ${ADDRESS_COLUMNS} FROM customer_addresses WHERE customer_id = ? AND id = ?`,
      [customerId, result.insertId],
    );
    await connection.commit();
    return rows[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function update(customerId, addressId, input) {
  const columns = {
    addressName: 'address_name', addressLine1: 'address_line1', addressLine2: 'address_line2',
    city: 'city', postalCode: 'postal_code', latitude: 'latitude', longitude: 'longitude',
  };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute(
      "SELECT id FROM customers WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [customerId],
    );
    if (!customers.length) { await connection.rollback(); return { customerInactive: true }; }
    const [rows] = await connection.execute(
      `SELECT id FROM customer_addresses WHERE customer_id = ? AND id = ? FOR UPDATE`,
      [customerId, addressId],
    );
    if (!rows.length) { await connection.rollback(); return null; }
    await connection.execute(
      `UPDATE customer_addresses SET ${assignments} WHERE customer_id = ? AND id = ?`,
      [...entries.map(([, value]) => value), customerId, addressId],
    );
    const [updated] = await connection.execute(
      `SELECT ${ADDRESS_COLUMNS} FROM customer_addresses WHERE customer_id = ? AND id = ?`,
      [customerId, addressId],
    );
    await connection.commit();
    return updated[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function setDefault(customerId, addressId) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute(
      "SELECT id FROM customers WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [customerId],
    );
    if (!customers.length) { await connection.rollback(); return { customerInactive: true }; }
    const [addresses] = await connection.execute(
      'SELECT id FROM customer_addresses WHERE customer_id = ? AND id = ? FOR UPDATE', [customerId, addressId],
    );
    if (!addresses.length) { await connection.rollback(); return null; }
    await connection.execute('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
    await connection.execute('UPDATE customer_addresses SET is_default = 1 WHERE customer_id = ? AND id = ?', [customerId, addressId]);
    const [rows] = await connection.execute(
      `SELECT ${ADDRESS_COLUMNS} FROM customer_addresses WHERE customer_id = ? AND id = ?`, [customerId, addressId],
    );
    await connection.commit();
    return rows[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function remove(customerId, addressId) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [customers] = await connection.execute(
      "SELECT id FROM customers WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [customerId],
    );
    if (!customers.length) { await connection.rollback(); return { customerInactive: true }; }
    const [addresses] = await connection.execute(
      `SELECT id, is_default FROM customer_addresses WHERE customer_id = ? AND id = ? FOR UPDATE`,
      [customerId, addressId],
    );
    const current = addresses[0];
    if (!current) { await connection.rollback(); return null; }
    await connection.execute('DELETE FROM customer_addresses WHERE customer_id = ? AND id = ?', [customerId, addressId]);
    if (current.is_default) {
      const [nextAddress] = await connection.execute(
        'SELECT id FROM customer_addresses WHERE customer_id = ? ORDER BY id LIMIT 1 FOR UPDATE', [customerId],
      );
      if (nextAddress.length) {
        await connection.execute('UPDATE customer_addresses SET is_default = 1 WHERE customer_id = ? AND id = ?', [customerId, nextAddress[0].id]);
      }
    }
    await connection.commit();
    return { deleted: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

module.exports = { list, findById, create, update, setDefault, remove };