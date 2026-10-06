const { getPool } = require('../config/database');

async function list(restaurantId) {
  const [rows] = await getPool().execute(
    `SELECT id, restaurant_id, name, created_at, updated_at
     FROM menu_categories WHERE restaurant_id = ? ORDER BY name, id`,
    [restaurantId],
  );
  return rows;
}

async function findById(restaurantId, categoryId) {
  const [rows] = await getPool().execute(
    `SELECT id, restaurant_id, name, created_at, updated_at
     FROM menu_categories WHERE restaurant_id = ? AND id = ? LIMIT 1`,
    [restaurantId, categoryId],
  );
  return rows[0] || null;
}

async function create(restaurantId, name) {
  const [result] = await getPool().execute(
    'INSERT INTO menu_categories (restaurant_id, name) VALUES (?, ?)', [restaurantId, name],
  );
  return findById(restaurantId, result.insertId);
}

async function update(restaurantId, categoryId, name) {
  await getPool().execute(
    'UPDATE menu_categories SET name = ? WHERE restaurant_id = ? AND id = ?',
    [name, restaurantId, categoryId],
  );
  return findById(restaurantId, categoryId);
}

async function remove(restaurantId, categoryId) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [categories] = await connection.execute(
      'SELECT id FROM menu_categories WHERE restaurant_id = ? AND id = ? FOR UPDATE',
      [restaurantId, categoryId],
    );
    if (!categories.length) { await connection.rollback(); return 'NOT_FOUND'; }
    const [items] = await connection.execute(
      'SELECT id FROM menu_items WHERE restaurant_id = ? AND category_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
      [restaurantId, categoryId],
    );
    if (items.length) { await connection.rollback(); return 'HAS_ITEMS'; }
    await connection.execute('DELETE FROM menu_categories WHERE restaurant_id = ? AND id = ?', [restaurantId, categoryId]);
    await connection.commit();
    return 'DELETED';
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { list, findById, create, update, remove };