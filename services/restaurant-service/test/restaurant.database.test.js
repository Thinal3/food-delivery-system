require('dotenv').config();

const testDatabase = process.env.RESTAURANT_TEST_DB_NAME?.trim();
const hasDedicatedTestDatabase = Boolean(testDatabase && /_test$/i.test(testDatabase));

if (hasDedicatedTestDatabase) {
  process.env.DB_NAME = testDatabase;
}

const test = require('node:test');
const assert = require('node:assert/strict');

test('MariaDB repositories preserve restaurant scoping, decimal strings, and soft deletes', {
  skip: !hasDedicatedTestDatabase
    ? 'Set RESTAURANT_TEST_DB_NAME to a separately initialized database ending in _test.'
    : false,
}, async () => {
  const { getPool, closePool } = require('../config/database');
  const restaurantRepo = require('../repositories/restaurant.repository');
  const categoryRepo = require('../repositories/category.repository');
  const menuRepo = require('../repositories/menu.repository');
  const pool = getPool();
  let restaurantId;
  let categoryId;
  let itemId;
  const unique = `integration-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await pool.query('SELECT 1 FROM restaurants LIMIT 0');
    await pool.query('SELECT 1 FROM menu_categories LIMIT 0');
    await pool.query('SELECT 1 FROM menu_items LIMIT 0');

    const restaurant = await restaurantRepo.create({
      ownerUserId: 4294967295,
      name: unique,
      description: null,
      address: 'Test-only address',
      contactNumber: '+1 555 0100',
      email: `${unique}@example.test`,
      cuisineType: 'Test cuisine',
      openingTime: '18:00',
      closingTime: '02:00',
    });
    restaurantId = Number(restaurant.id);
    assert.equal(restaurant.name, unique);

    const category = await categoryRepo.create(restaurantId, 'Test category');
    categoryId = Number(category.id);
    const item = await menuRepo.create(restaurantId, {
      categoryId,
      name: 'Exact decimal item',
      description: null,
      price: '12.50',
      availability: true,
      imageUrl: null,
    });
    itemId = Number(item.id);
    assert.equal(item.price, '12.50');
    assert.equal(await menuRepo.categoryBelongsToRestaurant(restaurantId + 1, categoryId), false);

    assert.equal(await categoryRepo.remove(restaurantId, categoryId), 'HAS_ITEMS');
    assert.equal(await menuRepo.softDelete(restaurantId, itemId), true);
    assert.equal(await menuRepo.findById(restaurantId, itemId), null);
    assert.equal(await categoryRepo.remove(restaurantId, categoryId), 'DELETED');

    const [orphanedItem] = await pool.execute(
      'SELECT category_id, deleted_at FROM menu_items WHERE restaurant_id = ? AND id = ?',
      [restaurantId, itemId],
    );
    assert.equal(orphanedItem[0].category_id, null);
    assert.ok(orphanedItem[0].deleted_at);
  } finally {
    if (restaurantId) {
      await pool.execute('DELETE FROM menu_items WHERE restaurant_id = ?', [restaurantId]);
      await pool.execute('DELETE FROM menu_categories WHERE restaurant_id = ?', [restaurantId]);
      await pool.execute('DELETE FROM restaurants WHERE id = ?', [restaurantId]);
    }
    await closePool();
  }
});