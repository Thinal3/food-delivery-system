const { getPool } = require('../config/database');

const ITEM_COLUMNS = `id, restaurant_id, category_id, name, description,
  CAST(price AS CHAR) AS price, availability, image_url, created_at, updated_at`;

async function list(restaurantId, { page, limit, categoryId, availability }) {
  const filters = ['restaurant_id = ?', 'deleted_at IS NULL'];
  const values = [restaurantId];
  if (categoryId !== undefined) { filters.push('category_id = ?'); values.push(categoryId); }
  if (availability !== undefined) { filters.push('availability = ?'); values.push(availability); }
  const where = filters.join(' AND ');
  const [rows] = await getPool().execute(
    `SELECT ${ITEM_COLUMNS} FROM menu_items WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
    [...values, limit, (page - 1) * limit],
  );
  const [counts] = await getPool().execute(`SELECT COUNT(*) AS total FROM menu_items WHERE ${where}`, values);
  return { items: rows, page, limit, total: Number(counts[0].total) };
}

async function findById(restaurantId, itemId) {
  const [rows] = await getPool().execute(
    `SELECT ${ITEM_COLUMNS} FROM menu_items WHERE restaurant_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1`,
    [restaurantId, itemId],
  );
  return rows[0] || null;
}

async function create(restaurantId, input) {
  const [result] = await getPool().execute(
    `INSERT INTO menu_items (restaurant_id, category_id, name, description, price, availability, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [restaurantId, input.categoryId, input.name, input.description ?? null,
      String(input.price), input.availability, input.imageUrl ?? null],
  );
  return findById(restaurantId, result.insertId);
}

async function update(restaurantId, itemId, input) {
  const columns = { categoryId: 'category_id', name: 'name', description: 'description', price: 'price', imageUrl: 'image_url' };
  const entries = Object.entries(input).filter(([key]) => columns[key]);
  const [result] = await getPool().execute(
    `UPDATE menu_items SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')}
     WHERE restaurant_id = ? AND id = ? AND deleted_at IS NULL`,
    [...entries.map(([key, value]) => (key === 'price' ? String(value) : value)), restaurantId, itemId],
  );
  return findById(restaurantId, itemId);
}

async function setAvailability(restaurantId, itemId, availability) {
  await getPool().execute(
    'UPDATE menu_items SET availability = ? WHERE restaurant_id = ? AND id = ? AND deleted_at IS NULL',
    [availability, restaurantId, itemId],
  );
  return findById(restaurantId, itemId);
}

async function softDelete(restaurantId, itemId) {
  const [result] = await getPool().execute(
    `UPDATE menu_items SET deleted_at = CURRENT_TIMESTAMP
     WHERE restaurant_id = ? AND id = ? AND deleted_at IS NULL`,
    [restaurantId, itemId],
  );
  return result.affectedRows > 0;
}

async function categoryBelongsToRestaurant(restaurantId, categoryId) {
  const [rows] = await getPool().execute(
    'SELECT id FROM menu_categories WHERE restaurant_id = ? AND id = ? LIMIT 1',
    [restaurantId, categoryId],
  );
  return rows.length > 0;
}

module.exports = { list, findById, create, update, setAvailability, softDelete, categoryBelongsToRestaurant };