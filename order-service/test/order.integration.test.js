process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_PORT ||= '3307';
process.env.DB_USER ||= 'fixture';
process.env.DB_PASSWORD ||= 'fixture-only';
process.env.DB_NAME ||= 'order_fixture_test';
process.env.SERVICE_REQUEST_TIMEOUT_MS = '80';
process.env.DELIVERY_FEE = '2.50';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let apiServer;
let dependencyServer;
let app;
let repo;
let baseUrl;
let dependencyUrl;
let dependencyMode;
let dbOrders;
let dbItems;
let nextId;
let nextItemId;
let shouldFailItems;
let restaurantState;
let menu;
let assignments;
const originalMethods = {};

const identities = {
  customer: { id: 42, role: 'CUSTOMER', status: 'ACTIVE' },
  otherCustomer: { id: 43, role: 'CUSTOMER', status: 'ACTIVE' },
  owner: { id: 9, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  otherOwner: { id: 10, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  admin: { id: 1, role: 'ADMIN', status: 'ACTIVE' },
  driver: { id: 11, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
  otherDriver: { id: 12, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function readOrder(id) {
  const order = dbOrders.get(Number(id));
  if (!order) return null;
  return { ...clone(order), items: dbItems.filter((item) => item.order_id === Number(id)).map(clone) };
}

function listOrders(predicate, query) {
  let rows = [...dbOrders.values()].filter((order) => predicate(order)
    && (!query.status || query.status === order.status));
  rows.sort((a, b) => b.id - a.id);
  const total = rows.length;
  rows = rows.slice((query.page - 1) * query.limit, query.page * query.limit);
  return { orders: rows.map((order) => readOrder(order.id)), page: query.page, limit: query.limit, total };
}

function installRepositoryFixture() {
  const implementations = {
    insertOrderWithItems: async (order, items) => {
      const id = nextId++;
      dbOrders.set(id, {
        id,
        customer_id: order.customerId,
        customer_user_id: order.customerUserId,
        restaurant_id: order.restaurantId,
        restaurant_owner_user_id: order.restaurantOwnerUserId,
        delivery_address: clone(order.deliveryAddress),
        subtotal: order.subtotal,
        delivery_fee: order.deliveryFee,
        total_amount: order.totalAmount,
        status: 'PENDING',
        created_at: new Date(),
        updated_at: new Date(),
      });
      try {
        for (const item of items) {
          if (shouldFailItems) { shouldFailItems = false; throw new Error('simulated item insert failure'); }
          dbItems.push({ id: nextItemId++, order_id: id, menu_item_id: item.menuItemId,
            item_name: item.itemName, quantity: item.quantity,
            unit_price: item.unitPrice, total_price: item.totalPrice });
        }
      } catch (error) {
        dbOrders.delete(id);
        dbItems = dbItems.filter((item) => item.order_id !== id);
        throw error;
      }
      return readOrder(id);
    },
    findById: async (id) => readOrder(id),
    listForCustomer: async (id, query) => listOrders((order) => order.customer_user_id === id, query),
    listForRestaurant: async (id, query) => listOrders((order) => order.restaurant_id === id, query),
    listAll: async (query) => listOrders(() => true, query),
    transitionIfCurrent: async (id, current, next) => {
      const order = dbOrders.get(Number(id));
      if (!order || order.status !== current) return false;
      order.status = next;
      return true;
    },
  };
  for (const [name, implementation] of Object.entries(implementations)) {
    originalMethods[name] = repo[name];
    repo[name] = implementation;
  }
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

const standardBody = {
  restaurantId: 5,
  deliveryAddressId: 22,
  items: [{ menuItemId: 101, quantity: 2 }, { menuItemId: 102, quantity: 1 }],
};

async function createOrder(token = 'customer', body = standardBody) {
  const result = await request('/api/orders', { method: 'POST', token, body });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.order;
}

test.before(async () => {
  dependencyServer = http.createServer((req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (dependencyMode === 'down') return send(res, 503, { error: 'upstream down' });
    if (dependencyMode === 'slow') return setTimeout(() => send(res, 200, { user: identities.customer }), 250);
    if (req.url === '/api/auth/verify') {
      return identities[token] ? send(res, 200, { user: identities[token] }) : send(res, 401, { error: 'invalid token' });
    }
    if (req.url === '/api/customers/me') {
      return token === 'customer'
        ? send(res, 200, { customer: { id: 901, user_id: 42, status: 'ACTIVE' } })
        : send(res, 403, { error: 'not customer' });
    }
    if (req.url.startsWith('/api/customers/me/addresses/')) {
      const addressId = Number(req.url.split('/').pop());
      if (addressId === 23) return send(res, 200, { address: { id: 23, customer_id: 902, line1: 'Other', city: 'Elsewhere' } });
      return addressId === 22
        ? send(res, 200, { address: { id: 22, customer_id: 901, line1: '10 Main St', line2: null, city: 'Sample', region: 'CA', postal_code: '90210', country: 'US' } })
        : send(res, 404, { error: 'missing address' });
    }
    const restaurantMatch = req.url.match(/^\/api\/restaurants\/(\d+)$/);
    if (restaurantMatch) {
      const restaurantId = Number(restaurantMatch[1]);
      if (![5, 6].includes(restaurantId)) return send(res, 404, { error: 'missing restaurant' });
      if (restaurantState.hideInactive && restaurantState.status === 'INACTIVE') {
        return send(res, 404, { error: 'hidden inactive restaurant' });
      }
      return send(res, 200, { restaurant: {
        id: restaurantId, owner_user_id: restaurantId === 5 ? 9 : 10,
        status: restaurantState.status, operating_status: restaurantState.operatingStatus,
      } });
    }
    const itemMatch = req.url.match(/^\/api\/restaurants\/(\d+)\/menu\/(\d+)$/);
    if (itemMatch) {
      const item = menu.get(Number(itemMatch[2]));
      return item ? send(res, 200, { item: clone(item) }) : send(res, 404, { error: 'missing item' });
    }
    const assignmentMatch = req.url.match(/^\/api\/deliveries\/me\/orders\/(\d+)\/assignment$/);
    if (assignmentMatch) {
      const orderId = Number(assignmentMatch[1]);
      const assignment = assignments.get(orderId);
      return assignment && assignment.delivery_person_user_id === identities[token]?.id
        ? send(res, 200, { assignment }) : send(res, 200, { assignment: null });
    }
    return send(res, 404, { error: 'unknown dependency endpoint' });
  });
  await new Promise((resolve) => dependencyServer.listen(0, '127.0.0.1', resolve));
  dependencyUrl = `http://127.0.0.1:${dependencyServer.address().port}`;
  process.env.AUTH_SERVICE_URL = dependencyUrl;
  process.env.RESTAURANT_SERVICE_URL = dependencyUrl;
  process.env.CUSTOMER_SERVICE_URL = dependencyUrl;
  process.env.DELIVERY_SERVICE_URL = dependencyUrl;
  repo = require('../repositories/order.repository');
  app = require('../app');
  installRepositoryFixture();
  await new Promise((resolve) => { apiServer = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
});

test.beforeEach(() => {
  dependencyMode = 'ready';
  restaurantState = { status: 'ACTIVE', operatingStatus: 'OPEN', hideInactive: false };
  menu = new Map([
    [101, { id: 101, restaurant_id: 5, name: 'Noodle Bowl', price: '10.25', availability: 1 }],
    [102, { id: 102, restaurant_id: 5, name: 'Tea', price: '4.50', availability: true }],
    [103, { id: 103, restaurant_id: 5, name: 'Sold out', price: '8.00', availability: false }],
    [201, { id: 201, restaurant_id: 6, name: 'Other menu', price: '1.00', availability: true }],
  ]);
  assignments = new Map();
  dbOrders = new Map();
  dbItems = [];
  nextId = 1;
  nextItemId = 1;
  shouldFailItems = false;
});

test.after(async () => {
  await Promise.all([
    new Promise((resolve) => apiServer.close(resolve)),
    new Promise((resolve) => dependencyServer.close(resolve)),
  ]);
  for (const [name, method] of Object.entries(originalMethods)) repo[name] = method;
});

test('health works and protected routes reject missing or invalid tokens', async () => {
  assert.deepEqual((await request('/health')).body, { status: 'ok' });
  assert.equal((await request('/api/orders/mine')).status, 401);
  assert.equal((await request('/api/orders/mine', { token: 'bad' })).status, 401);
});

test('creation calculates exact totals from Restaurant prices and snapshots distinct IDs/address', async () => {
  const order = await createOrder();
  assert.equal(order.customer_id, 901);
  assert.equal(order.customer_user_id, 42);
  assert.notEqual(order.customer_id, order.customer_user_id);
  assert.equal(order.subtotal, '25.00');
  assert.equal(order.delivery_fee, '2.50');
  assert.equal(order.total_amount, '27.50');
  assert.equal(order.status, 'PENDING');
  assert.equal(order.items[0].item_name, 'Noodle Bowl');
  assert.equal(order.items[0].unit_price, '10.25');
  assert.equal(order.items[0].total_price, '20.50');
  assert.equal(order.delivery_address.city, 'Sample');
});

test('unknown client price, totals, customer, owner, and status fields are rejected', async () => {
  const body = { ...standardBody, customerId: 901, customerUserId: 999,
    subtotal: '0.01', deliveryFee: '0', totalAmount: '0.01', status: 'DELIVERED',
    items: [{ menuItemId: 101, quantity: 1, price: '0.01', itemName: 'Fake' }] };
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body })).status, 400);
  const order = await createOrder();
  assert.equal(order.items[0].unit_price, '10.25');
});

test('only CUSTOMER creates orders; foreign address and invalid quantities/items are rejected', async () => {
  assert.equal((await request('/api/orders', { method: 'POST', token: 'owner', body: standardBody })).status, 403);
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: { ...standardBody, deliveryAddressId: 23 } })).status, 404);
  for (const quantity of [0, -1, 1.5, 100]) {
    assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: { ...standardBody, items: [{ menuItemId: 101, quantity }] } })).status, 400);
  }
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: { ...standardBody, items: [{ menuItemId: 101, quantity: 1 }, { menuItemId: 101, quantity: 3 }] } })).status, 400);
});

test('closed/inactive restaurant, sold-out item, and item from another restaurant block order', async () => {
  restaurantState.operatingStatus = 'CLOSED';
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: standardBody })).status, 409);
  restaurantState.operatingStatus = 'OPEN';
  restaurantState.status = 'INACTIVE';
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: standardBody })).status, 409);
  restaurantState.hideInactive = true;
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: standardBody })).status, 409);
  restaurantState.status = 'ACTIVE';
  restaurantState.hideInactive = false;
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: { ...standardBody, items: [{ menuItemId: 103, quantity: 1 }] } })).status, 409);
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: { ...standardBody, items: [{ menuItemId: 999, quantity: 1 }] } })).status, 409);
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: { ...standardBody, items: [{ menuItemId: 201, quantity: 1 }] } })).status, 502);
});

test('fixture repository rolls back order and items after a simulated item insert failure', async () => {
  shouldFailItems = true;
  const result = await request('/api/orders', { method: 'POST', token: 'customer', body: standardBody });
  assert.equal(result.status, 500);
  assert.equal(dbOrders.size, 0);
  assert.equal(dbItems.length, 0);
});

test('customer history is private and restaurant history checks current Restaurant ownership', async () => {
  const order = await createOrder();
  assert.equal((await request('/api/orders/mine', { token: 'customer' })).body.total, 1);
  assert.equal((await request('/api/orders/mine', { token: 'otherCustomer' })).body.total, 0);
  assert.equal((await request(`/api/orders/${order.id}`, { token: 'otherCustomer' })).status, 403);
  assert.equal((await request('/api/orders/restaurant/5', { token: 'owner' })).body.total, 1);
  assert.equal((await request('/api/orders/restaurant/5', { token: 'otherOwner' })).status, 403);
  assert.equal((await request('/api/orders/', { token: 'owner' })).status, 403);
  assert.equal((await request('/api/orders/', { token: 'admin' })).body.total, 1);
});

test('restaurant lifecycle requires one transition per request; Delivery checks assignment', async () => {
  const order = await createOrder();
  assert.equal((await request(`/api/orders/${order.id}/status`, { method: 'PATCH', token: 'owner', body: { status: 'PREPARING' } })).status, 409);
  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    assert.equal((await request(`/api/orders/${order.id}/status`, { method: 'PATCH', token: 'owner', body: { status } })).status, 200);
  }
  assert.equal((await request(`/api/orders/${order.id}/status`, { method: 'PATCH', token: 'otherDriver', body: { status: 'PICKED_UP' } })).status, 403);
  assignments.set(order.id, { order_id: order.id, delivery_person_user_id: 11, status: 'ACTIVE' });
  dependencyMode = 'down';
  assert.equal((await request(`/api/orders/${order.id}`, { token: 'driver' })).status, 503);
  dependencyMode = 'ready';
  for (const status of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
    assert.equal((await request(`/api/orders/${order.id}/status`, { method: 'PATCH', token: 'driver', body: { status } })).status, 200);
  }
  assert.equal((await request(`/api/orders/${order.id}/status`, { method: 'PATCH', token: 'admin', body: { status: 'CANCELLED' } })).status, 409);
});

test('customer and restaurant cancellation permissions stop after preparation or pickup', async () => {
  const order = await createOrder();
  assert.equal((await request(`/api/orders/${order.id}/cancel`, { method: 'POST', token: 'otherCustomer' })).status, 403);
  assert.equal((await request(`/api/orders/${order.id}/cancel`, { method: 'POST', token: 'customer' })).body.order.status, 'CANCELLED');
  const second = await createOrder();
  await request(`/api/orders/${second.id}/status`, { method: 'PATCH', token: 'owner', body: { status: 'CONFIRMED' } });
  assert.equal((await request(`/api/orders/${second.id}/cancel`, { method: 'POST', token: 'owner' })).body.order.status, 'CANCELLED');
});

test('two concurrent changes cannot both win a compare-and-set transition', async () => {
  const order = await createOrder();
  const results = await Promise.all([
    request(`/api/orders/${order.id}/status`, { method: 'PATCH', token: 'owner', body: { status: 'CONFIRMED' } }),
    request(`/api/orders/${order.id}/cancel`, { method: 'POST', token: 'customer' }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
});

test('stored address and menu snapshots do not change when upstream data changes', async () => {
  const order = await createOrder();
  menu.get(101).name = 'Renamed';
  menu.get(101).price = '99.99';
  const fetched = await request(`/api/orders/${order.id}`, { token: 'customer' });
  assert.equal(fetched.body.order.items[0].item_name, 'Noodle Bowl');
  assert.equal(fetched.body.order.items[0].unit_price, '10.25');
  assert.equal(fetched.body.order.delivery_address.city, 'Sample');
});

test('upstream failure and timeout fail closed before any order is written', async () => {
  dependencyMode = 'down';
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: standardBody })).status, 503);
  dependencyMode = 'slow';
  assert.equal((await request('/api/orders', { method: 'POST', token: 'customer', body: standardBody })).status, 503);
  assert.equal(dbOrders.size, 0);
});

test('history status filter rejects values outside the lifecycle', async () => {
  assert.equal((await request('/api/orders/mine?status=UNKNOWN', { token: 'customer' })).status, 400);
});