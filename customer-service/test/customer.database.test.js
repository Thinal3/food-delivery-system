require('dotenv').config();

const testDatabase = process.env.CUSTOMER_TEST_DB_NAME?.trim();
const safeTestDatabase = Boolean(testDatabase && /_test$/i.test(testDatabase));
if (safeTestDatabase) process.env.DB_NAME = testDatabase;

const test = require('node:test');
const assert = require('node:assert/strict');

test('MariaDB enforces profile uniqueness and serialized address defaults', {
  skip: !safeTestDatabase
    ? 'Set CUSTOMER_TEST_DB_NAME to a separately initialized database ending in _test.'
    : false,
}, async () => {
  const customers = require('../repositories/customer.repository');
  const addresses = require('../repositories/address.repository');
  const { getPool, closePool } = require('../config/database');
  const pool = getPool();
  const userId = 3000000000 + Math.floor(Math.random() * 1000000);
  let customerId;

  try {
    await pool.query('SELECT 1 FROM customers LIMIT 0');
    await pool.query('SELECT 1 FROM customer_addresses LIMIT 0');
    const customer = await customers.create(userId, {
      firstName: 'DB Test', lastName: 'Customer', phoneNumber: '+1 555 000 0000',
    });
    customerId = Number(customer.id);
    assert.notEqual(customerId, userId);
    await assert.rejects(customers.create(userId, {
      firstName: 'Duplicate', lastName: 'Profile', phoneNumber: '+1 555 000 0001',
    }), (error) => error.code === 'ER_DUP_ENTRY');

    const addressInput = (addressName) => ({
      addressName, addressLine1: 'Test-only street', addressLine2: null,
      city: 'Test City', postalCode: '00000', isDefault: false,
    });
    const created = await Promise.all([
      addresses.create(customerId, addressInput('A')),
      addresses.create(customerId, addressInput('B')),
      addresses.create(customerId, addressInput('C')),
    ]);
    const list = await addresses.list(customerId);
    assert.equal(list.length, 3);
    assert.equal(list.filter((row) => Boolean(row.is_default)).length, 1);

    const chosen = list[2];
    const [firstChange, competingChange] = await Promise.all([
      addresses.setDefault(customerId, chosen.id),
      addresses.setDefault(customerId, list[1].id),
    ]);
    assert.ok(firstChange.is_default || competingChange.is_default);
    const afterSelection = await addresses.list(customerId);
    assert.equal(afterSelection.filter((row) => Boolean(row.is_default)).length, 1);

    const defaultAddress = afterSelection.find((row) => Boolean(row.is_default));
    await addresses.remove(customerId, defaultAddress.id);
    const afterDelete = await addresses.list(customerId);
    assert.equal(afterDelete.filter((row) => Boolean(row.is_default)).length, 1);
    for (const address of afterDelete) await addresses.remove(customerId, address.id);
    assert.equal((await addresses.list(customerId)).length, 0);
  } finally {
    if (customerId) {
      await pool.execute('DELETE FROM customer_addresses WHERE customer_id = ?', [customerId]);
      await pool.execute('DELETE FROM customers WHERE id = ?', [customerId]);
    }
    await closePool();
  }
});