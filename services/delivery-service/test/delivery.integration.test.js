process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_PORT ||= '3307';
process.env.DB_USER ||= 'fixture';
process.env.DB_PASSWORD ||= 'fixture';
process.env.DB_NAME ||= 'delivery_fixture_test';
process.env.SERVICE_REQUEST_TIMEOUT_MS = '80';
process.env.ORDER_DELIVERY_SYNC_SECRET = 'fixture-order-delivery-sync-secret-at-least-32';
process.env.SYNC_MAX_ATTEMPTS = '3';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let app;
let apiServer;
let dependencies;
let apiUrl;
let dependencyUrl;
let repo;
let mode;
let orders;
let restaurants;
let authUsers;
let deliveries;
let syncTasks;
let nextId;
let nextTaskId;
let orderGetCount;
const originals = {};

const identities = {
  admin: { id: 1, role: 'ADMIN', status: 'ACTIVE' },
  owner: { id: 9, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  otherOwner: { id: 10, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  driver: { id: 11, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
  otherDriver: { id: 12, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
  thirdDriver: { id: 13, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
  customer: { id: 42, role: 'CUSTOMER', status: 'ACTIVE' },
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

function installRepo() {
  const implementations = {
    create: async (input) => {
      if ([...deliveries.values()].some((row) => row.order_id === input.orderId)) {
        const error = new Error('duplicate delivery order'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      const row = {
        id: nextId++, order_id: input.orderId, delivery_person_id: null,
        restaurant_id: input.restaurantId, customer_id: input.customerId,
        customer_user_id: input.customerUserId, restaurant_owner_user_id: input.restaurantOwnerUserId,
        pickup_address: clone(input.pickupAddress), delivery_address: clone(input.deliveryAddress),
        status: 'PENDING', assigned_at: null, pickup_at: null, delivered_at: null,
        failed_at: null, cancelled_at: null, failure_reason: null,
        created_at: new Date(), updated_at: new Date(),
      };
      deliveries.set(row.id, row);
      return clone(row);
    },
    findById: async (id) => clone(deliveries.get(Number(id)) || null),
    findByOrderId: async (id) => clone([...deliveries.values()].find((row) => row.order_id === Number(id)) || null),
    listForPerson: async (userId, query) => listRows((row) => row.delivery_person_id === userId, query),
    listForRestaurant: async (restaurantId, query) => listRows((row) => row.restaurant_id === restaurantId, query),
    listForCustomer: async (userId, query) => listRows((row) => row.customer_user_id === userId, query),
    listAll: async (query) => listRows(() => true, query),
    updateAssignment: async (id, personId, expected) => {
      const row = deliveries.get(Number(id));
      if (!row) return { notFound: true };
      if (!expected.includes(row.status)) return { conflict: true };
      row.delivery_person_id = personId;
      if (row.status === 'PENDING') row.status = 'ASSIGNED';
      row.assigned_at = new Date();
      return { delivery: clone(row) };
    },
    transition: async (id, nextStatus, { expectedStatus, failureReason }) => {
      const row = deliveries.get(Number(id));
      if (!row) return { notFound: true };
      if (row.status !== expectedStatus) return { conflict: true };
      row.status = nextStatus;
      if (nextStatus === 'PICKED_UP') row.pickup_at = new Date();
      if (nextStatus === 'DELIVERED') row.delivered_at = new Date();
      if (nextStatus === 'FAILED') { row.failed_at = new Date(); row.failure_reason = failureReason; }
      if (nextStatus === 'CANCELLED') row.cancelled_at = new Date();
      if (['PICKED_UP', 'ON_THE_WAY', 'DELIVERED'].includes(nextStatus)) {
        const taskId = nextTaskId++;
        syncTasks.set(taskId, { id: taskId, delivery_id: row.id, order_id: row.order_id,
          target_status: nextStatus, attempts: 0, state: 'PENDING' });
      }
      return { delivery: clone(row) };
    },
    claimNextSyncTask: async () => {
      const task = [...syncTasks.values()].find((row) => row.state === 'PENDING');
      if (!task) return null;
      task.state = 'PROCESSING';
      return clone(task);
    },
    markSyncSucceeded: async (id) => { syncTasks.get(Number(id)).state = 'SYNCED'; },
    markSyncFailed: async (task) => {
      const row = syncTasks.get(Number(task.id));
      row.attempts += 1;
      row.state = row.attempts >= 3 ? 'FAILED' : 'PENDING';
    },
    getAssignmentByOrderId: async (orderId) => {
      const row = [...deliveries.values()].find((delivery) => delivery.order_id === Number(orderId));
      return row ? { id: row.id, order_id: row.order_id, delivery_person_id: row.delivery_person_id, status: row.status } : null;
    },
    getInternalStatus: async (orderId) => {
      const row = [...deliveries.values()].find((delivery) => delivery.order_id === Number(orderId));
      return row ? { id: row.id, order_id: row.order_id, delivery_person_id: row.delivery_person_id, status: row.status } : null;
    },
  };
  for (const [name, implementation] of Object.entries(implementations)) {
    originals[name] = repo[name];
    repo[name] = implementation;
  }
}

function listRows(predicate, query) {
  let rows = [...deliveries.values()].filter((row) => predicate(row) && (!query.status || row.status === query.status));
  rows.sort((a, b) => b.id - a.id);
  const total = rows.length;
  rows = rows.slice((query.page - 1) * query.limit, query.page * query.limit);
  return { deliveries: rows.map(clone), page: query.page, limit: query.limit, total };
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function createDelivery(token = 'owner', orderId = 20) {
  const result = await request('/api/deliveries', { method: 'POST', token, body: { orderId } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.delivery;
}

test.before(async () => {
  dependencies = http.createServer((req, res) => {
    if (mode === 'down') return send(res, 503, { error: 'unavailable' });
    if (mode === 'slow') return setTimeout(() => send(res, 200, { user: identities.owner }), 250);
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (req.url === '/api/auth/verify') return identities[token]
      ? send(res, 200, { user: identities[token] }) : send(res, 401, { error: 'invalid' });
    if (req.url.startsWith('/api/auth/users?')) {
      if (token !== 'admin') return send(res, 403, { error: 'admin only' });
      return send(res, 200, { users: authUsers, page: 1, limit: 100, total: authUsers.length });
    }
    const orderMatch = req.url.match(/^\/api\/orders\/(\d+)$/);
    if (orderMatch) {
      orderGetCount += 1;
      const orderId = Number(orderMatch[1]);
      const order = orders.get(orderId);
      if (!order) return send(res, 404, { error: 'not found' });
      if (token !== 'admin' && token !== 'owner') return send(res, 403, { error: 'not accessible' });
      return send(res, 200, { order: clone(order) });
    }
    if (req.method === 'POST' && req.url === '/api/orders/internal/delivery-sync') {
      if (req.headers.authorization !== `Bearer ${process.env.ORDER_DELIVERY_SYNC_SECRET}`) {
        return send(res, 401, { error: 'sync auth failed' });
      }
      return mode === 'syncFail'
        ? send(res, 503, { error: 'Order unavailable for sync' })
        : send(res, 200, { order: { status: 'synchronized' } });
    }
    const restaurantMatch = req.url.match(/^\/api\/restaurants\/(\d+)$/);
    if (restaurantMatch) {
      const id = Number(restaurantMatch[1]);
      const restaurant = restaurants.get(id);
      if (!restaurant) return send(res, 404, { error: 'not found' });
      if (token !== 'admin' && token !== 'owner' && token !== 'otherOwner') return send(res, 403, { error: 'not allowed' });
      return send(res, 200, { restaurant: clone(restaurant) });
    }
    if (req.method === 'POST' && req.url === '/api/orders/internal/delivery-sync') {
      return send(res, 200, { order: { status: 'synced' } });
    }
    return send(res, 404, { error: 'unknown endpoint' });
  });
  await new Promise((resolve) => dependencies.listen(0, '127.0.0.1', resolve));
  dependencyUrl = `http://127.0.0.1:${dependencies.address().port}`;
  process.env.AUTH_SERVICE_URL = dependencyUrl;
  process.env.ORDER_SERVICE_URL = dependencyUrl;
  process.env.RESTAURANT_SERVICE_URL = dependencyUrl;
  repo = require('../repositories/delivery.repository');
  app = require('../app');
  installRepo();
  await new Promise((resolve) => { apiServer = app.listen(0, '127.0.0.1', resolve); });
  apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
});

test.beforeEach(() => {
  mode = 'ready';
  orders = new Map([[20, {
    id: 20, customer_id: 701, customer_user_id: 42, restaurant_id: 5,
    restaurant_owner_user_id: 9, status: 'READY_FOR_PICKUP',
    delivery_address: { id: 8, address_line1: 'Customer snapshot', city: 'Customer City' },
  }], [21, {
    id: 21, customer_id: 702, customer_user_id: 43, restaurant_id: 6,
    restaurant_owner_user_id: 10, status: 'PREPARING',
    delivery_address: { id: 9, address_line1: 'Other snapshot', city: 'Other City' },
  }]]);
  restaurants = new Map([[5, { id: 5, owner_user_id: 9, name: 'Food Place', address: '1 Restaurant Road', contact_number: '555-1000' }],
    [6, { id: 6, owner_user_id: 10, name: 'Another Place', address: '2 Restaurant Road', contact_number: '555-2000' }]]);
  authUsers = [
    { user_id: 11, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
    { user_id: 12, role: 'DELIVERY_PERSON', status: 'INACTIVE' },
    { user_id: 13, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
  ];
  deliveries = new Map();
  syncTasks = new Map();
  nextId = 1;
  nextTaskId = 1;
  orderGetCount = 0;
});

test.after(async () => {
  await Promise.all([
    new Promise((resolve) => apiServer.close(resolve)),
    new Promise((resolve) => dependencies.close(resolve)),
  ]);
  for (const [name, implementation] of Object.entries(originals)) repo[name] = implementation;
});

test('health and auth restrictions work; public delivery data is never exposed', async () => {
  assert.deepEqual((await request('/health')).body, { status: 'ok' });
  assert.equal((await request('/api/deliveries/1')).status, 401);
  assert.equal((await request('/api/deliveries/', { token: 'customer' })).status, 403);
});

test('owner creates delivery only for READY_FOR_PICKUP order and snapshots Order/Restaurant addresses', async () => {
  const beforeOrderCalls = orderGetCount;
  const result = await request('/api/deliveries', { method: 'POST', token: 'owner', body: { orderId: 20 } });
  assert.equal(result.status, 201);
  assert.equal(result.body.delivery.status, 'PENDING');
  assert.equal(result.body.delivery.delivery_person_id, null);
  assert.equal(result.body.delivery.restaurant_id, 5);
  assert.equal(result.body.delivery.customer_id, 701);
  assert.equal(result.body.delivery.customer_user_id, 42);
  assert.equal(result.body.delivery.pickup_address.address, '1 Restaurant Road');
  assert.equal(result.body.delivery.delivery_address.address_line1, 'Customer snapshot');
  assert.equal(orderGetCount, beforeOrderCalls + 1);
  assert.equal((await request('/api/deliveries', { method: 'POST', token: 'owner', body: { orderId: 20 } })).status, 409);
  assert.equal((await request('/api/deliveries', { method: 'POST', token: 'otherOwner', body: { orderId: 20 } })).status, 403);
  assert.equal((await request('/api/deliveries', { method: 'POST', token: 'owner', body: { orderId: 21 } })).status, 409);
});

test('ADMIN and current owner can create; other owner/caller roles cannot', async () => {
  assert.equal((await request('/api/deliveries', { method: 'POST', token: 'admin', body: { orderId: 20 } })).status, 201);
  assert.equal((await request('/api/deliveries', { method: 'POST', token: 'otherOwner', body: { orderId: 20 } })).status, 403);
  assert.equal((await request('/api/deliveries', { method: 'POST', token: 'driver', body: { orderId: 20 } })).status, 403);
  assert.equal((await request('/api/deliveries', { method: 'POST', body: { orderId: 20 } })).status, 401);
});

test('only ADMIN can assign an active Auth DELIVERY_PERSON; reassignment stops at pickup', async () => {
  const delivery = await createDelivery();
  assert.equal((await request(`/api/deliveries/${delivery.id}/assign`, {
    method: 'PATCH', token: 'owner', body: { deliveryPersonId: 11 },
  })).status, 403);
  assert.equal((await request(`/api/deliveries/${delivery.id}/assign`, {
    method: 'PATCH', token: 'admin', body: { deliveryPersonId: 12 },
  })).status, 400);
  const assigned = await request(`/api/deliveries/${delivery.id}/assign`, {
    method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 },
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.delivery.status, 'ASSIGNED');
  assert.ok(assigned.body.delivery.assigned_at);
  const reassigned = await request(`/api/deliveries/${delivery.id}/assign`, {
    method: 'PATCH', token: 'admin', body: { deliveryPersonId: 13 },
  });
  assert.equal(reassigned.status, 200);
  assert.equal(reassigned.body.delivery.delivery_person_id, 13);
  assert.equal((await request(`/api/deliveries/${delivery.id}/status`, {
    method: 'PATCH', token: 'admin', body: { status: 'PICKUP_PENDING' },
  })).status, 200);
  assert.equal((await request(`/api/deliveries/${delivery.id}/assign`, {
    method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 },
  })).status, 200);
  assert.equal((await request(`/api/deliveries/${delivery.id}/status`, {
    method: 'PATCH', token: 'admin', body: { status: 'PICKED_UP' },
  })).status, 200);
  assert.equal((await request(`/api/deliveries/${delivery.id}/assign`, {
    method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 },
  })).status, 409);
});

test('assigned delivery person progresses lifecycle; invalid jumps, cancellation after pickup, and missing failure reason reject', async () => {
  const delivery = await createDelivery();
  await request(`/api/deliveries/${delivery.id}/assign`, { method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 } });
  assert.equal((await request(`/api/deliveries/${delivery.id}/status`, {
    method: 'PATCH', token: 'driver', body: { status: 'ON_THE_WAY' },
  })).status, 409);
  assert.equal((await request(`/api/deliveries/${delivery.id}/status`, {
    method: 'PATCH', token: 'driver', body: { status: 'PICKUP_PENDING' },
  })).status, 200);
  assert.equal((await request(`/api/deliveries/${delivery.id}/status`, {
    method: 'PATCH', token: 'driver', body: { status: 'FAILED' },
  })).status, 400);
  assert.equal((await request(`/api/deliveries/${delivery.id}/status`, {
    method: 'PATCH', token: 'driver', body: { status: 'PICKED_UP' },
  })).status, 200);
  assert.ok(deliveries.get(delivery.id).pickup_at);
  assert.equal((await request(`/api/deliveries/${delivery.id}/cancel`, { method: 'POST', token: 'admin' })).status, 409);
});

test('restaurant owner can cancel before pickup; FAILED and CANCELLED do not enqueue Order states', async () => {
  const ownerCancelled = await createDelivery();
  assert.equal((await request(`/api/deliveries/${ownerCancelled.id}/cancel`, {
    method: 'POST', token: 'owner',
  })).status, 200);
  assert.ok(deliveries.get(ownerCancelled.id).cancelled_at);
  assert.equal(syncTasks.size, 0);

  orders.get(21).status = 'READY_FOR_PICKUP';
  const failed = await createDelivery('admin', 21);
  await request(`/api/deliveries/${failed.id}/assign`, {
    method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 },
  });
  await request(`/api/deliveries/${failed.id}/status`, {
    method: 'PATCH', token: 'driver', body: { status: 'PICKUP_PENDING' },
  });
  const markedFailed = await request(`/api/deliveries/${failed.id}/status`, {
    method: 'PATCH', token: 'driver', body: { status: 'FAILED', failureReason: 'Road closure' },
  });
  assert.equal(markedFailed.status, 200);
  assert.equal(markedFailed.body.delivery.failure_reason, 'Road closure');
  assert.ok(markedFailed.body.delivery.failed_at);
  assert.equal(syncTasks.size, 0);
});

test('concurrent Delivery transitions cannot both update the same prior state', async () => {
  const delivery = await createDelivery();
  await request(`/api/deliveries/${delivery.id}/assign`, {
    method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 },
  });
  await request(`/api/deliveries/${delivery.id}/status`, {
    method: 'PATCH', token: 'driver', body: { status: 'PICKUP_PENDING' },
  });
  const outcomes = await Promise.all([
    request(`/api/deliveries/${delivery.id}/status`, {
      method: 'PATCH', token: 'driver', body: { status: 'PICKED_UP' },
    }),
    request(`/api/deliveries/${delivery.id}/status`, {
      method: 'PATCH', token: 'driver', body: { status: 'PICKED_UP' },
    }),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [200, 409]);
});

test('customer, current owner, and assigned person access is scoped; assignment callback does not call Order', async () => {
  const delivery = await createDelivery();
  await request(`/api/deliveries/${delivery.id}/assign`, { method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 } });
  assert.equal((await request(`/api/deliveries/${delivery.id}`, { token: 'customer' })).status, 200);
  assert.equal((await request(`/api/deliveries/${delivery.id}`, { token: 'otherOwner' })).status, 403);
  assert.equal((await request(`/api/deliveries/${delivery.id}`, { token: 'otherDriver' })).status, 403);
  const before = orderGetCount;
  const callback = await request('/api/deliveries/me/orders/20/assignment', { token: 'driver' });
  assert.equal(callback.status, 200);
  assert.equal(callback.body.assignment.delivery_person_user_id, 11);
  assert.equal(orderGetCount, before);
});

test('delivery progress saves outbox event and worker synchronizes through scoped Order endpoint', async () => {
  const delivery = await createDelivery();
  await request(`/api/deliveries/${delivery.id}/assign`, { method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 } });
  await request(`/api/deliveries/${delivery.id}/status`, { method: 'PATCH', token: 'driver', body: { status: 'PICKUP_PENDING' } });
  await request(`/api/deliveries/${delivery.id}/status`, { method: 'PATCH', token: 'driver', body: { status: 'PICKED_UP' } });
  const worker = require('../services/sync.worker');
  await worker.processOne();
  assert.equal([...syncTasks.values()][0].state, 'SYNCED');
  assert.equal([...syncTasks.values()][0].target_status, 'PICKED_UP');
  assert.equal(deliveries.get(delivery.id).status, 'PICKED_UP');
});

test('outbox emits delivery milestones in order for one Order', async () => {
  const delivery = await createDelivery();
  await request(`/api/deliveries/${delivery.id}/assign`, { method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 } });
  for (const status of ['PICKUP_PENDING', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
    await request(`/api/deliveries/${delivery.id}/status`, { method: 'PATCH', token: 'driver', body: { status } });
  }
  const worker = require('../services/sync.worker');
  for (let index = 0; index < 3; index += 1) await worker.processOne();
  assert.deepEqual([...syncTasks.values()].map((task) => task.target_status), ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']);
  assert.ok([...syncTasks.values()].every((task) => task.state === 'SYNCED'));
});

test('Order outage retries outbox and marks bounded failures without changing Delivery state', async () => {
  const delivery = await createDelivery();
  await request(`/api/deliveries/${delivery.id}/assign`, { method: 'PATCH', token: 'admin', body: { deliveryPersonId: 11 } });
  await request(`/api/deliveries/${delivery.id}/status`, { method: 'PATCH', token: 'driver', body: { status: 'PICKUP_PENDING' } });
  await request(`/api/deliveries/${delivery.id}/status`, { method: 'PATCH', token: 'driver', body: { status: 'PICKED_UP' } });
  mode = 'syncFail';
  const worker = require('../services/sync.worker');
  await worker.processOne();
  assert.equal([...syncTasks.values()][0].state, 'PENDING');
  assert.equal(deliveries.get(delivery.id).status, 'PICKED_UP');
  await worker.processOne();
  await worker.processOne();
  assert.equal([...syncTasks.values()][0].state, 'FAILED');
  assert.equal(deliveries.get(delivery.id).status, 'PICKED_UP');
});

test('Auth/Order/Restaurant outages fail closed and malformed delivery creation bodies reject', async () => {
  mode = 'down';
  assert.equal((await request('/api/deliveries/mine', { token: 'driver' })).status, 503);
  mode = 'ready';
  assert.equal((await request('/api/deliveries', { method: 'POST', token: 'owner', body: { orderId: 20, customerId: 42 } })).status, 400);
  assert.equal((await request('/api/deliveries/999', { token: 'admin' })).status, 404);
});