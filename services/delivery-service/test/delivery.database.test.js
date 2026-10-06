require('dotenv').config();

const testDatabaseName = process.env.DELIVERY_TEST_DB_NAME?.trim();
const safeTestDatabase = Boolean(testDatabaseName && /_test$/i.test(testDatabaseName));
if (safeTestDatabase) process.env.DB_NAME = testDatabaseName;

const test = require('node:test');
const assert = require('node:assert/strict');

test('MariaDB persists delivery snapshots, unique orders, and transactional sync events', {
  skip: !safeTestDatabase
    ? 'Set DELIVERY_TEST_DB_NAME to a separate initialized database ending in _test.'
    : false,
}, async () => {
  const repository = require('../repositories/delivery.repository');
  const { getPool, closePool } = require('../config/database');
  const pool = getPool();
  const orderId = 4000000000 + Math.floor(Math.random() * 1000000);
  let deliveryId;

  try {
    await pool.query('SELECT 1 FROM deliveries LIMIT 0');
    await pool.query('SELECT 1 FROM delivery_order_sync LIMIT 0');
    const delivery = await repository.create({
      orderId,
      restaurantId: 400001,
      customerId: 400002,
      customerUserId: 400003,
      restaurantOwnerUserId: 400004,
      pickupAddress: { restaurantId: 5, address: 'Pickup snapshot' },
      deliveryAddress: { customerId: 8, address_line1: 'Drop-off snapshot' },
    });
    deliveryId = Number(delivery.id);
    assert.deepEqual(delivery.delivery_address, { customerId: 8, address_line1: 'Drop-off snapshot' });

    await assert.rejects(repository.create({
      orderId,
      restaurantId: 400001,
      customerId: 400002,
      customerUserId: 400003,
      restaurantOwnerUserId: 400004,
      pickupAddress: {},
      deliveryAddress: {},
    }), (error) => error.code === 'ER_DUP_ENTRY');

    const assigned = await repository.updateAssignment(deliveryId, 400005, ['PENDING']);
    assert.equal(assigned.delivery.status, 'ASSIGNED');
    const waiting = await repository.transition(deliveryId, 'PICKUP_PENDING', { expectedStatus: 'ASSIGNED' });
    assert.equal(waiting.delivery.status, 'PICKUP_PENDING');
    const pickedUp = await repository.transition(deliveryId, 'PICKED_UP', { expectedStatus: 'PICKUP_PENDING' });
    assert.equal(pickedUp.delivery.status, 'PICKED_UP');
    assert.ok(pickedUp.delivery.pickup_at);

    const assignment = await repository.getAssignmentByOrderId(orderId);
    assert.equal(Number(assignment.delivery_person_id), 400005);
    const task = await repository.claimNextSyncTask();
    assert.equal(Number(task.delivery_id), deliveryId);
    assert.equal(Number(task.order_id), orderId);
    assert.equal(task.target_status, 'PICKED_UP');
    await repository.markSyncSucceeded(task.id);
  } finally {
    if (deliveryId) {
      await pool.execute('DELETE FROM delivery_order_sync WHERE delivery_id = ?', [deliveryId]);
      await pool.execute('DELETE FROM deliveries WHERE id = ?', [deliveryId]);
    }
    await closePool();
  }
});