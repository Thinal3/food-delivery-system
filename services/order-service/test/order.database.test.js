require('dotenv').config();

const testDbName = process.env.ORDER_TEST_DB_NAME?.trim();
const safeTestDatabase = Boolean(testDbName && /_test$/i.test(testDbName));
if (safeTestDatabase) process.env.DB_NAME = testDbName;

const test = require('node:test');
const assert = require('node:assert/strict');

test('MariaDB persists snapshots, rolls back partial orders, and conditionally advances status', {
  skip: !safeTestDatabase
    ? 'Set ORDER_TEST_DB_NAME to a dedicated initialized database ending in _test.'
    : false,
}, async () => {
  const repository = require('../repositories/order.repository');
  const { getPool, closePool } = require('../config/database');
  const pool = getPool();
  const customerUserId = 1000000000 + Math.floor(Math.random() * 1000000);
  let orderId;

  try {
    await pool.query('SELECT 1 FROM orders LIMIT 0');
    await pool.query('SELECT 1 FROM order_items LIMIT 0');

    await assert.rejects(repository.insertOrderWithItems({
      customerId: 700001,
      customerUserId,
      restaurantId: 700001,
      restaurantOwnerUserId: 700002,
      deliveryAddress: { id: 8, line1: 'Test snapshot', city: 'Test City' },
      subtotal: '1.00', deliveryFee: '0.00', totalAmount: '1.00',
    }, [{ menuItemId: 700001, itemName: 'Rollback item', quantity: 1, unitPrice: null, totalPrice: '1.00' }]));
    const [afterRollback] = await pool.execute(
      'SELECT COUNT(*) AS total FROM orders WHERE customer_user_id = ?', [customerUserId],
    );
    assert.equal(Number(afterRollback[0].total), 0);

    const order = await repository.insertOrderWithItems({
      customerId: 700001,
      customerUserId,
      restaurantId: 700001,
      restaurantOwnerUserId: 700002,
      deliveryAddress: { id: 8, line1: 'Test snapshot', city: 'Test City' },
      subtotal: '12.50', deliveryFee: '2.50', totalAmount: '15.00',
    }, [{ menuItemId: 700003, itemName: 'Snapshot Dish', quantity: 1, unitPrice: '12.50', totalPrice: '12.50' }]);
    orderId = Number(order.id);
    assert.equal(order.total_amount, '15.00');
    assert.equal(order.items[0].unit_price, '12.50');
    assert.deepEqual(order.delivery_address, { id: 8, line1: 'Test snapshot', city: 'Test City' });
    assert.equal(await repository.transitionIfCurrent(orderId, 'PENDING', 'CONFIRMED'), true);
    assert.equal(await repository.transitionIfCurrent(orderId, 'PENDING', 'CANCELLED'), false);
  } finally {
    if (orderId) {
      await pool.execute('DELETE FROM order_items WHERE order_id = ?', [orderId]);
      await pool.execute('DELETE FROM orders WHERE id = ?', [orderId]);
    }
    await closePool();
  }
});