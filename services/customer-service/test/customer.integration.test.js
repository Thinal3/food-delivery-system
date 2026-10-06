process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_PORT ||= '3307';
process.env.DB_USER ||= 'fixture';
process.env.DB_PASSWORD ||= 'fixture';
process.env.DB_NAME ||= 'customer_fixture_test';
process.env.SERVICE_REQUEST_TIMEOUT_MS = '80';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let app;
let apiServer;
let authServer;
let baseUrl;
let authMode;
let profiles;
let addressRows;
let nextCustomerId;
let nextAddressId;
const lockQueues = new Map();
const originalRepositories = [];

const identities = {
  customer: { id: 42, role: 'CUSTOMER', status: 'ACTIVE' },
  otherCustomer: { id: 43, role: 'CUSTOMER', status: 'ACTIVE' },
  inactiveAuth: { id: 44, role: 'CUSTOMER', status: 'INACTIVE' },
  admin: { id: 1, role: 'ADMIN', status: 'ACTIVE' },
  restaurantAdmin: { id: 50, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  delivery: { id: 60, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function serializeCustomer(row) {
  return row ? clone(row) : null;
}

function serializeAddress(row) {
  return row ? clone(row) : null;
}

function withCustomerLock(customerId, operation) {
  const previous = lockQueues.get(customerId) || Promise.resolve();
  const next = previous.then(operation, operation);
  lockQueues.set(customerId, next.catch(() => {}));
  return next;
}

function installRepositories() {
  const customerRepository = require('../repositories/customer.repository');
  const addressRepository = require('../repositories/address.repository');
  const replace = (repository, method, implementation) => {
    originalRepositories.push([repository, method, repository[method]]);
    repository[method] = implementation;
  };

  replace(customerRepository, 'findByUserId', async (userId) => (
    serializeCustomer([...profiles.values()].find((profile) => profile.user_id === userId))
  ));
  replace(customerRepository, 'findById', async (customerId) => serializeCustomer(profiles.get(Number(customerId))));
  replace(customerRepository, 'create', async (userId, input) => {
    if ([...profiles.values()].some((profile) => profile.user_id === userId)) {
      const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
    }
    const row = {
      id: nextCustomerId++, user_id: userId, first_name: input.firstName,
      last_name: input.lastName, phone_number: input.phoneNumber,
      profile_image: input.profileImage ?? null, status: 'ACTIVE',
      created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    profiles.set(row.id, row);
    return serializeCustomer(row);
  });
  replace(customerRepository, 'updateByUserId', async (userId, input) => {
    const row = [...profiles.values()].find((profile) => profile.user_id === userId);
    if (!row || row.status !== 'ACTIVE') return null;
    const aliases = { firstName: 'first_name', lastName: 'last_name', phoneNumber: 'phone_number', profileImage: 'profile_image' };
    for (const [key, value] of Object.entries(input)) row[aliases[key]] = value;
    return serializeCustomer(row);
  });
  replace(customerRepository, 'list', async (page, limit) => {
    const all = [...profiles.values()].sort((a, b) => a.id - b.id);
    return { customers: all.slice((page - 1) * limit, page * limit).map(serializeCustomer), page, limit, total: all.length };
  });
  replace(customerRepository, 'setStatus', async (customerId, status) => {
    const row = profiles.get(Number(customerId));
    if (!row) return null;
    row.status = status;
    return serializeCustomer(row);
  });

  replace(addressRepository, 'list', async (customerId) => [...addressRows.values()]
    .filter((row) => row.customer_id === customerId)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.id - b.id)
    .map(serializeAddress));
  replace(addressRepository, 'findById', async (customerId, addressId) => {
    const row = addressRows.get(Number(addressId));
    return row && row.customer_id === customerId ? serializeAddress(row) : null;
  });
  replace(addressRepository, 'create', async (customerId, input) => withCustomerLock(customerId, async () => {
    const customer = profiles.get(customerId);
    if (!customer || customer.status !== 'ACTIVE') return { customerInactive: true };
    const existing = [...addressRows.values()].filter((row) => row.customer_id === customerId);
    const makeDefault = input.isDefault || existing.length === 0;
    if (makeDefault) for (const row of existing) row.is_default = 0;
    const row = {
      id: nextAddressId++, customer_id: customerId, address_name: input.addressName,
      address_line1: input.addressLine1, address_line2: input.addressLine2 ?? null,
      city: input.city, postal_code: input.postalCode,
      latitude: input.latitude ?? null, longitude: input.longitude ?? null,
      is_default: Number(makeDefault), created_at: new Date(), updated_at: new Date(),
    };
    addressRows.set(row.id, row);
    return serializeAddress(row);
  }));
  replace(addressRepository, 'update', async (customerId, addressId, input) => withCustomerLock(customerId, async () => {
    const customer = profiles.get(customerId);
    if (!customer || customer.status !== 'ACTIVE') return { customerInactive: true };
    const row = addressRows.get(Number(addressId));
    if (!row || row.customer_id !== customerId) return null;
    const aliases = { addressName: 'address_name', addressLine1: 'address_line1', addressLine2: 'address_line2', city: 'city', postalCode: 'postal_code', latitude: 'latitude', longitude: 'longitude' };
    for (const [key, value] of Object.entries(input)) row[aliases[key]] = value;
    return serializeAddress(row);
  }));
  replace(addressRepository, 'setDefault', async (customerId, addressId) => withCustomerLock(customerId, async () => {
    const customer = profiles.get(customerId);
    if (!customer || customer.status !== 'ACTIVE') return { customerInactive: true };
    const selected = addressRows.get(Number(addressId));
    if (!selected || selected.customer_id !== customerId) return null;
    for (const row of addressRows.values()) if (row.customer_id === customerId) row.is_default = 0;
    selected.is_default = 1;
    return serializeAddress(selected);
  }));
  replace(addressRepository, 'remove', async (customerId, addressId) => withCustomerLock(customerId, async () => {
    const customer = profiles.get(customerId);
    if (!customer || customer.status !== 'ACTIVE') return { customerInactive: true };
    const row = addressRows.get(Number(addressId));
    if (!row || row.customer_id !== customerId) return null;
    addressRows.delete(Number(addressId));
    if (row.is_default) {
      const replacement = [...addressRows.values()].filter((address) => address.customer_id === customerId).sort((a, b) => a.id - b.id)[0];
      if (replacement) replacement.is_default = 1;
    }
    return { deleted: true };
  }));
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const profileBody = {
  firstName: 'Jamie', lastName: 'Customer', phoneNumber: '+1 555 0100',
  profileImage: 'https://example.test/profile.jpg',
};
const addressBody = {
  addressName: 'Home', addressLine1: '14 Main Street', addressLine2: null,
  city: 'Sample City', postalCode: '90210', latitude: 34.1, longitude: -118.2,
};

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (authMode === 'down') return send(res, 503, { error: 'down' });
    if (authMode === 'slow') return setTimeout(() => send(res, 200, { user: identities.customer }), 250);
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    return identities[token]
      ? send(res, 200, { user: identities[token] })
      : send(res, 401, { error: 'invalid token' });
  });
  await new Promise((resolve) => authServer.listen(0, '127.0.0.1', resolve));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${authServer.address().port}`;
  const { authServiceUrl } = require('../config/env');
  process.env.AUTH_SERVICE_URL = authServiceUrl;
  installRepositories();
  app = require('../app');
  await new Promise((resolve) => { apiServer = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
});

test.beforeEach(() => {
  authMode = 'ready';
  profiles = new Map();
  addressRows = new Map();
  lockQueues.clear();
  nextCustomerId = 100;
  nextAddressId = 500;
});

test.after(async () => {
  await Promise.all([
    new Promise((resolve) => apiServer.close(resolve)),
    new Promise((resolve) => authServer.close(resolve)),
  ]);
  for (const [repository, method, implementation] of originalRepositories) repository[method] = implementation;
});

async function createProfile(token = 'customer', body = profileBody) {
  const result = await request('/api/customers/me', { method: 'POST', token, body });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.customer;
}

test('health and readiness routes are registered', async () => {
  assert.deepEqual((await request('/health')).body, { status: 'ok' });
});

test('CUSTOMER creates a profile linked to Auth identity, not the same numeric ID', async () => {
  const customer = await createProfile();
  assert.equal(customer.id, 100);
  assert.equal(customer.user_id, 42);
  assert.notEqual(customer.id, customer.user_id);
  assert.equal(customer.status, 'ACTIVE');
  assert.equal(Object.hasOwn(customer, 'password_hash'), false);
});

test('duplicate profile creation conflicts and identity/protected fields are rejected', async () => {
  await createProfile();
  assert.equal((await request('/api/customers/me', { method: 'POST', token: 'customer', body: profileBody })).status, 409);
  assert.equal((await request('/api/customers/me', {
    method: 'POST', token: 'customer', body: { ...profileBody, user_id: 777 },
  })).status, 400);
  assert.equal((await request('/api/customers/me', {
    method: 'PATCH', token: 'customer', body: { status: 'INACTIVE' },
  })).status, 400);
});

test('profiles are private to owner; only ADMIN can inspect others or change status', async () => {
  const customer = await createProfile();
  assert.equal((await request('/api/customers/me', { token: 'otherCustomer' })).status, 404);
  assert.equal((await request(`/api/customers/${customer.id}`, { token: 'customer' })).status, 403);
  assert.equal((await request('/api/customers', { token: 'restaurantAdmin' })).status, 403);
  assert.equal((await request(`/api/customers/${customer.id}`, { token: 'admin' })).body.customer.user_id, 42);
  assert.equal((await request(`/api/customers/${customer.id}/status`, {
    method: 'PATCH', token: 'admin', body: { status: 'INACTIVE' },
  })).status, 200);
  assert.equal((await request('/api/customers/me/addresses', { token: 'customer' })).status, 403);
});

test('addresses create/list/get/update/delete are scoped and Order receives compatible aliases', async () => {
  await createProfile();
  const created = await request('/api/customers/me/addresses', { method: 'POST', token: 'customer', body: addressBody });
  assert.equal(created.status, 201);
  assert.equal(created.body.address.is_default, true);
  assert.equal(created.body.address.customer_id, 100);
  assert.equal(created.body.address.line1, '14 Main Street');
  assert.equal(created.body.address.postalCode, '90210');
  const addressId = created.body.address.id;
  assert.equal((await request(`/api/customers/me/addresses/${addressId}`, { token: 'otherCustomer' })).status, 404);
  const changed = await request(`/api/customers/me/addresses/${addressId}`, {
    method: 'PATCH', token: 'customer', body: { city: 'Updated City' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.address.city, 'Updated City');
  assert.equal((await request('/api/customers/me/addresses', { token: 'customer' })).body.addresses.length, 1);
  assert.equal((await request(`/api/customers/me/addresses/${addressId}`, { method: 'DELETE', token: 'customer' })).status, 204);
  assert.equal((await request(`/api/customers/me/addresses/${addressId}`, { token: 'customer' })).status, 404);
});

test('existing Order Customer client resolves profile and address from Customer HTTP endpoints', async () => {
  await createProfile();
  const created = await request('/api/customers/me/addresses', {
    method: 'POST', token: 'customer', body: addressBody,
  });
  const orderCustomerClientPath = require.resolve('../../order-service/services/customer.client');
  process.env.CUSTOMER_SERVICE_URL = baseUrl;
  const orderCustomerClient = require(orderCustomerClientPath);
  const customer = await orderCustomerClient.getCustomerForUser(42, 'Bearer customer');
  assert.deepEqual(customer, { id: 100, userId: 42 });
  const address = await orderCustomerClient.getOwnedAddress(
    created.body.address.id, customer.id, 'Bearer customer',
  );
  assert.equal(address.line1, addressBody.addressLine1);
  assert.equal(address.city, addressBody.city);
  assert.equal(address.postalCode, addressBody.postalCode);
});

test('first address defaults automatically; selecting default and concurrent creates preserve one default', async () => {
  await createProfile();
  const [first, second, third] = await Promise.all([
    request('/api/customers/me/addresses', { method: 'POST', token: 'customer', body: addressBody }),
    request('/api/customers/me/addresses', { method: 'POST', token: 'customer', body: { ...addressBody, addressName: 'Work' } }),
    request('/api/customers/me/addresses', { method: 'POST', token: 'customer', body: { ...addressBody, addressName: 'Other' } }),
  ]);
  assert.deepEqual([first.status, second.status, third.status], [201, 201, 201]);
  assert.equal([...addressRows.values()].filter((row) => row.is_default).length, 1);
  const ids = [...addressRows.keys()].sort((a, b) => a - b);
  const selected = await request(`/api/customers/me/addresses/${ids[2]}/default`, {
    method: 'PATCH', token: 'customer', body: {},
  });
  assert.equal(selected.body.address.is_default, true);
  assert.equal([...addressRows.values()].filter((row) => row.is_default).length, 1);
  await request(`/api/customers/me/addresses/${ids[2]}`, { method: 'DELETE', token: 'customer' });
  assert.equal([...addressRows.values()].filter((row) => row.is_default).length, 1);
  assert.equal([...addressRows.values()].find((row) => row.is_default).id, ids[0]);
  await request(`/api/customers/me/addresses/${ids[0]}`, { method: 'DELETE', token: 'customer' });
  await request(`/api/customers/me/addresses/${ids[1]}`, { method: 'DELETE', token: 'customer' });
  assert.equal([...addressRows.values()].filter((row) => row.is_default).length, 0);
});

test('coordinates must be paired and within bounds; address metadata is not editable', async () => {
  await createProfile();
  assert.equal((await request('/api/customers/me/addresses', {
    method: 'POST', token: 'customer', body: { ...addressBody, longitude: undefined },
  })).status, 400);
  assert.equal((await request('/api/customers/me/addresses', {
    method: 'POST', token: 'customer', body: { ...addressBody, latitude: 91 },
  })).status, 400);
  const address = await request('/api/customers/me/addresses', { method: 'POST', token: 'customer', body: addressBody });
  assert.equal((await request(`/api/customers/me/addresses/${address.body.address.id}`, {
    method: 'PATCH', token: 'customer', body: { customer_id: 999 },
  })).status, 400);
  assert.equal((await request(`/api/customers/me/addresses/${address.body.address.id}`, {
    method: 'PATCH', token: 'customer', body: { latitude: null, longitude: null },
  })).status, 200);
});

test('inactive Auth and Customer identities cannot mutate addresses; Auth outages fail closed', async () => {
  assert.equal((await request('/api/customers/me', { token: 'inactiveAuth' })).status, 502);
  authMode = 'down';
  assert.equal((await request('/api/customers/me', { token: 'customer' })).status, 503);
  authMode = 'slow';
  assert.equal((await request('/api/customers/me', { token: 'customer' })).status, 503);
  authMode = 'ready';
  await createProfile();
  await request('/api/customers/100/status', { method: 'PATCH', token: 'admin', body: { status: 'INACTIVE' } });
  assert.equal((await request('/api/customers/me/addresses', { method: 'POST', token: 'customer', body: addressBody })).status, 403);
});

test('wrong roles cannot use customer self-service and malformed requests fail validation', async () => {
  assert.equal((await request('/api/customers/me', { token: 'delivery' })).status, 403);
  assert.equal((await request('/api/customers/me', { method: 'POST', token: 'customer', body: { ...profileBody, id: 5 } })).status, 400);
  assert.equal((await request('/api/customers?page=0', { token: 'admin' })).status, 400);
});