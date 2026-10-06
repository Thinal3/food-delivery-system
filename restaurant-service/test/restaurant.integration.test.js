process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_PORT ||= '3307';
process.env.DB_USER ||= 'test-user';
process.env.DB_PASSWORD ||= 'test-password';
process.env.DB_NAME ||= 'food_delivery_restaurant_test';
process.env.AUTH_REQUEST_TIMEOUT_MS = '100';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let app;
let server;
let authServer;
let baseUrl;
let authUrl;
let authMode = 'ready';
let restaurants;
let categories;
let items;
let nextRestaurantId;
let nextCategoryId;
let nextItemId;
const originalMethods = new Map();
const identities = {
  'admin-token': { id: 1, role: 'ADMIN', status: 'ACTIVE' },
  'owner-token': { id: 10, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  'other-owner-token': { id: 11, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  'customer-token': { id: 20, role: 'CUSTOMER', status: 'ACTIVE' },
  'delivery-token': { id: 30, role: 'DELIVERY_PERSON', status: 'ACTIVE' },
};
const ownerDirectory = [
  { user_id: 10, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  { user_id: 11, role: 'RESTAURANT_ADMIN', status: 'ACTIVE' },
  { user_id: 12, role: 'RESTAURANT_ADMIN', status: 'INACTIVE' },
];

function response(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function publicRestaurant(row) {
  return clone(row);
}

function publicItem(row) {
  if (!row || row.deleted_at) return null;
  const { deleted_at, ...safe } = row;
  return clone(safe);
}

function installRepositoryFixtures() {
  const restaurantRepo = require('../repositories/restaurant.repository');
  const categoryRepo = require('../repositories/category.repository');
  const menuRepo = require('../repositories/menu.repository');
  const capture = (repo, name, implementation) => {
    if (!originalMethods.has(`${repo === restaurantRepo ? 'r' : repo === categoryRepo ? 'c' : 'm'}:${name}`)) {
      originalMethods.set(`${repo === restaurantRepo ? 'r' : repo === categoryRepo ? 'c' : 'm'}:${name}`, [repo, name, repo[name]]);
    }
    repo[name] = implementation;
  };

  capture(restaurantRepo, 'create', async (input) => {
    const row = {
      id: nextRestaurantId++, owner_user_id: input.ownerUserId, name: input.name,
      description: input.description ?? null, address: input.address,
      contact_number: input.contactNumber, email: input.email,
      cuisine_type: input.cuisineType, opening_time: input.openingTime ?? null,
      closing_time: input.closingTime ?? null, status: 'ACTIVE',
      operating_status: 'CLOSED', created_at: new Date(), updated_at: new Date(),
    };
    restaurants.set(row.id, row);
    return publicRestaurant(row);
  });
  capture(restaurantRepo, 'listPublic', async ({ page, limit, cuisine, operatingStatus }) => {
    const found = [...restaurants.values()].filter((row) => row.status === 'ACTIVE'
      && (!cuisine || row.cuisine_type === cuisine)
      && (!operatingStatus || row.operating_status === operatingStatus));
    return { restaurants: found.slice((page - 1) * limit, page * limit).map(publicRestaurant), page, limit, total: found.length };
  });
  capture(restaurantRepo, 'listMine', async (ownerId, page, limit) => {
    const found = [...restaurants.values()].filter((row) => Number(row.owner_user_id) === ownerId);
    return { restaurants: found.slice((page - 1) * limit, page * limit).map(publicRestaurant), page, limit, total: found.length };
  });
  capture(restaurantRepo, 'listAll', async (page, limit) => {
    const found = [...restaurants.values()];
    return { restaurants: found.slice((page - 1) * limit, page * limit).map(publicRestaurant), page, limit, total: found.length };
  });
  capture(restaurantRepo, 'findById', async (id) => publicRestaurant(restaurants.get(Number(id))));
  capture(restaurantRepo, 'findOwned', async (id, ownerId) => {
    const row = restaurants.get(Number(id));
    return row && Number(row.owner_user_id) === ownerId ? publicRestaurant(row) : null;
  });
  capture(restaurantRepo, 'update', async (id, input) => {
    const row = restaurants.get(Number(id));
    if (!row) return null;
    const mapping = { contactNumber: 'contact_number', cuisineType: 'cuisine_type', openingTime: 'opening_time', closingTime: 'closing_time' };
    for (const [key, value] of Object.entries(input)) row[mapping[key] || key] = value;
    return publicRestaurant(row);
  });
  capture(restaurantRepo, 'setStatus', async (id, status) => {
    const row = restaurants.get(Number(id));
    if (!row) return null;
    row.status = status;
    return publicRestaurant(row);
  });
  capture(restaurantRepo, 'setOperatingStatus', async (id, status) => {
    const row = restaurants.get(Number(id));
    if (!row) return null;
    row.operating_status = status;
    return publicRestaurant(row);
  });
  capture(restaurantRepo, 'deactivate', async (id) => {
    const row = restaurants.get(Number(id));
    if (!row || row.status === 'INACTIVE') return false;
    row.status = 'INACTIVE';
    return true;
  });

  capture(categoryRepo, 'list', async (restaurantId) => [...categories.values()]
    .filter((row) => row.restaurant_id === restaurantId).map(clone));
  capture(categoryRepo, 'findById', async (restaurantId, categoryId) => {
    const row = categories.get(Number(categoryId));
    return row && row.restaurant_id === restaurantId ? clone(row) : null;
  });
  capture(categoryRepo, 'create', async (restaurantId, name) => {
    if ([...categories.values()].some((row) => row.restaurant_id === restaurantId && row.name.toLowerCase() === name.toLowerCase())) {
      const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
    }
    const row = { id: nextCategoryId++, restaurant_id: restaurantId, name, created_at: new Date(), updated_at: new Date() };
    categories.set(row.id, row);
    return clone(row);
  });
  capture(categoryRepo, 'update', async (restaurantId, categoryId, name) => {
    const row = categories.get(Number(categoryId));
    if (!row || row.restaurant_id !== restaurantId) return null;
    if ([...categories.values()].some((other) => other.id !== row.id && other.restaurant_id === restaurantId && other.name.toLowerCase() === name.toLowerCase())) {
      const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
    }
    row.name = name;
    return clone(row);
  });
  capture(categoryRepo, 'remove', async (restaurantId, categoryId) => {
    const row = categories.get(Number(categoryId));
    if (!row || row.restaurant_id !== restaurantId) return 'NOT_FOUND';
    if ([...items.values()].some((item) => item.restaurant_id === restaurantId
      && item.category_id === Number(categoryId) && !item.deleted_at)) return 'HAS_ITEMS';
    categories.delete(Number(categoryId));
    for (const item of items.values()) if (item.category_id === Number(categoryId)) item.category_id = null;
    return 'DELETED';
  });

  capture(menuRepo, 'list', async (restaurantId, query) => {
    const found = [...items.values()].filter((item) => item.restaurant_id === restaurantId
      && !item.deleted_at
      && (query.categoryId === undefined || item.category_id === query.categoryId)
      && (query.availability === undefined || item.availability === query.availability));
    return { items: found.slice((query.page - 1) * query.limit, query.page * query.limit).map(publicItem), page: query.page, limit: query.limit, total: found.length };
  });
  capture(menuRepo, 'findById', async (restaurantId, itemId) => {
    const row = items.get(Number(itemId));
    return row && row.restaurant_id === restaurantId ? publicItem(row) : null;
  });
  capture(menuRepo, 'categoryBelongsToRestaurant', async (restaurantId, categoryId) => {
    const row = categories.get(Number(categoryId));
    return Boolean(row && row.restaurant_id === restaurantId);
  });
  capture(menuRepo, 'create', async (restaurantId, input) => {
    const row = {
      id: nextItemId++, restaurant_id: restaurantId, category_id: input.categoryId,
      name: input.name, description: input.description ?? null,
      price: String(input.price), availability: input.availability,
      image_url: input.imageUrl ?? null, deleted_at: null,
      created_at: new Date(), updated_at: new Date(),
    };
    items.set(row.id, row);
    return publicItem(row);
  });
  capture(menuRepo, 'update', async (restaurantId, itemId, input) => {
    const row = items.get(Number(itemId));
    if (!row || row.restaurant_id !== restaurantId || row.deleted_at) return null;
    const mapping = { categoryId: 'category_id', imageUrl: 'image_url' };
    for (const [key, value] of Object.entries(input)) row[mapping[key] || key] = key === 'price' ? String(value) : value;
    return publicItem(row);
  });
  capture(menuRepo, 'setAvailability', async (restaurantId, itemId, availability) => {
    const row = items.get(Number(itemId));
    if (!row || row.restaurant_id !== restaurantId || row.deleted_at) return null;
    row.availability = availability;
    return publicItem(row);
  });
  capture(menuRepo, 'softDelete', async (restaurantId, itemId) => {
    const row = items.get(Number(itemId));
    if (!row || row.restaurant_id !== restaurantId || row.deleted_at) return false;
    row.deleted_at = new Date();
    return true;
  });
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const restaurantBody = {
  name: 'Local Kitchen', address: '14 Main Street', contactNumber: '+1 555 0100',
  email: 'hello@local.test', cuisineType: 'Italian',
  openingTime: '18:00', closingTime: '02:00',
};

test.before(async () => {
  authServer = http.createServer((req, res) => {
    if (authMode === 'slow') return setTimeout(() => response(res, 200, { user: identities['owner-token'] }), 300);
    if (authMode === 'unavailable') return response(res, 503, { error: 'unavailable' });
    if (req.url === '/api/auth/verify') {
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      return token && identities[`${token}-revoked`] ? response(res, 401, { error: 'invalid' })
        : token && identities[token] ? response(res, 200, { user: identities[token] })
          : response(res, 401, { error: 'invalid' });
    }
    if (req.url.startsWith('/api/auth/users?')) {
      if (req.headers.authorization !== 'Bearer admin-token') return response(res, 403, { error: 'forbidden' });
      return response(res, 200, { users: ownerDirectory, page: 1, limit: 100, total: ownerDirectory.length });
    }
    return response(res, 404, { error: 'not found' });
  });
  await new Promise((resolve) => authServer.listen(0, '127.0.0.1', resolve));
  authUrl = `http://127.0.0.1:${authServer.address().port}`;
  process.env.AUTH_SERVICE_URL = authUrl;

  installRepositoryFixtures();
  app = require('../app');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.beforeEach(() => {
  authMode = 'ready';
  restaurants = new Map();
  categories = new Map();
  items = new Map();
  nextRestaurantId = 1;
  nextCategoryId = 1;
  nextItemId = 1;
});

test.after(async () => {
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => authServer.close(resolve)),
  ]);
  for (const [repo, name, implementation] of originalMethods.values()) repo[name] = implementation;
});

async function createOwnedRestaurant(token = 'owner-token') {
  const result = await request('/api/restaurants', { method: 'POST', token, body: restaurantBody });
  assert.equal(result.status, 201);
  return result.body.restaurant;
}

test('health and readiness work without database access in the route fixture', async () => {
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok' });
});

test('restaurant admin creates restaurant owned by its Auth identity; admin can verify owner through Auth', async () => {
  const owned = await createOwnedRestaurant();
  assert.equal(Number(owned.owner_user_id), 10);
  assert.equal(owned.opening_time, '18:00');
  assert.equal(owned.closing_time, '02:00');

  const adminCreated = await request('/api/restaurants', {
    method: 'POST', token: 'admin-token', body: { ...restaurantBody, ownerUserId: 11 },
  });
  assert.equal(adminCreated.status, 201);
  assert.equal(Number(adminCreated.body.restaurant.owner_user_id), 11);
  assert.equal((await request('/api/restaurants', {
    method: 'POST', token: 'admin-token', body: { ...restaurantBody, ownerUserId: 12 },
  })).status, 400);
});

test('missing, invalid, and wrong-role tokens cannot write restaurant data', async () => {
  assert.equal((await request('/api/restaurants', { method: 'POST', body: restaurantBody })).status, 401);
  assert.equal((await request('/api/restaurants', { method: 'POST', token: 'bad-token', body: restaurantBody })).status, 401);
  assert.equal((await request('/api/restaurants', { method: 'POST', token: 'customer-token', body: restaurantBody })).status, 403);
});

test('owner can manage own restaurant but another owner cannot read inactive or update it', async () => {
  const restaurant = await createOwnedRestaurant();
  assert.equal((await request(`/api/restaurants/${restaurant.id}`, { token: 'owner-token' })).status, 200);
  assert.equal((await request(`/api/restaurants/${restaurant.id}`, { token: 'other-owner-token' })).status, 200);
  assert.equal((await request(`/api/restaurants/${restaurant.id}`, { method: 'PATCH', token: 'other-owner-token', body: { name: 'Stolen' } })).status, 403);
  await request(`/api/restaurants/${restaurant.id}/status`, { method: 'PATCH', token: 'owner-token', body: { status: 'INACTIVE' } });
  assert.equal((await request(`/api/restaurants/${restaurant.id}`)).status, 404);
  assert.equal((await request(`/api/restaurants/${restaurant.id}`, { token: 'other-owner-token' })).status, 404);
  assert.equal((await request('/api/restaurants/mine', { token: 'owner-token' })).body.restaurants.length, 1);
  assert.equal((await request(`/api/restaurants/${restaurant.id}`, { token: 'admin-token' })).status, 200);
});

test('public list includes active CLOSED restaurants and excludes inactive restaurants', async () => {
  const active = await createOwnedRestaurant();
  await request(`/api/restaurants/${active.id}/operating-status`, { method: 'PATCH', token: 'owner-token', body: { operatingStatus: 'CLOSED' } });
  const inactive = await createOwnedRestaurant('other-owner-token');
  await request(`/api/restaurants/${inactive.id}/status`, { method: 'PATCH', token: 'other-owner-token', body: { status: 'INACTIVE' } });
  const result = await request('/api/restaurants?cuisine=Italian&operatingStatus=CLOSED');
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.restaurants[0].operating_status, 'CLOSED');
});

test('strict restaurant validation rejects owner changes, invalid time pairs, and unsafe filters', async () => {
  assert.equal((await request('/api/restaurants', { method: 'POST', token: 'owner-token', body: { ...restaurantBody, ownerUserId: 11 } })).status, 400);
  const { closingTime, ...incompleteHours } = restaurantBody;
  assert.equal((await request('/api/restaurants', { method: 'POST', token: 'owner-token', body: incompleteHours })).status, 400);
  assert.equal((await request('/api/restaurants?ownerUserId=11')).status, 400);
  assert.equal((await request('/api/restaurants?cuisine=x%27%20OR%201%3D1--')).body.total, 0);
});

test('categories are unique per restaurant and reject deletion while active items use them', async () => {
  const restaurant = await createOwnedRestaurant();
  const path = `/api/restaurants/${restaurant.id}/categories`;
  const category = await request(path, { method: 'POST', token: 'owner-token', body: { name: 'Mains' } });
  assert.equal(category.status, 201);
  assert.equal((await request(path, { method: 'POST', token: 'owner-token', body: { name: 'Mains' } })).status, 409);
  const item = await request(`/api/restaurants/${restaurant.id}/menu`, {
    method: 'POST', token: 'owner-token', body: { categoryId: category.body.category.id, name: 'Pasta', price: '12.50' },
  });
  assert.equal(item.status, 201);
  assert.equal((await request(`${path}/${category.body.category.id}`, { method: 'DELETE', token: 'owner-token' })).status, 409);
  await request(`/api/restaurants/${restaurant.id}/menu/${item.body.item.id}`, { method: 'DELETE', token: 'owner-token' });
  assert.equal((await request(`${path}/${category.body.category.id}`, { method: 'DELETE', token: 'owner-token' })).status, 204);
});

test('menu items require same-restaurant categories and exact positive DECIMAL strings', async () => {
  const first = await createOwnedRestaurant();
  const second = await createOwnedRestaurant('other-owner-token');
  const firstCategory = await request(`/api/restaurants/${first.id}/categories`, { method: 'POST', token: 'owner-token', body: { name: 'Mains' } });
  const secondCategory = await request(`/api/restaurants/${second.id}/categories`, { method: 'POST', token: 'other-owner-token', body: { name: 'Mains' } });
  const path = `/api/restaurants/${first.id}/menu`;
  assert.equal((await request(path, { method: 'POST', token: 'owner-token', body: { categoryId: secondCategory.body.category.id, name: 'Foreign item', price: '2.00' } })).status, 400);
  for (const price of ['0', '-2.00', '2.999', '1e2', 2.5]) {
    assert.equal((await request(path, { method: 'POST', token: 'owner-token', body: { categoryId: firstCategory.body.category.id, name: 'Bad price', price } })).status, 400);
  }
  const valid = await request(path, { method: 'POST', token: 'owner-token', body: {
    categoryId: firstCategory.body.category.id, name: 'Soup', price: '4.50', imageUrl: 'https://example.test/soup.jpg',
  } });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.item.price, '4.50');
});

test('menu updates, availability, soft deletion, and nested IDs remain restaurant-scoped', async () => {
  const first = await createOwnedRestaurant();
  const second = await createOwnedRestaurant('other-owner-token');
  const category = await request(`/api/restaurants/${first.id}/categories`, { method: 'POST', token: 'owner-token', body: { name: 'Mains' } });
  const item = await request(`/api/restaurants/${first.id}/menu`, { method: 'POST', token: 'owner-token', body: { categoryId: category.body.category.id, name: 'Soup', price: '4.50' } });
  const itemId = item.body.item.id;
  assert.equal((await request(`/api/restaurants/${second.id}/menu/${itemId}`, { token: 'other-owner-token' })).status, 404);
  const changed = await request(`/api/restaurants/${first.id}/menu/${itemId}`, { method: 'PATCH', token: 'owner-token', body: { price: '5.25' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.item.price, '5.25');
  const unavailable = await request(`/api/restaurants/${first.id}/menu/${itemId}/availability`, { method: 'PATCH', token: 'owner-token', body: { availability: false } });
  assert.equal(unavailable.body.item.availability, false);
  assert.equal((await request(`/api/restaurants/${first.id}/menu/${itemId}`, { method: 'DELETE', token: 'owner-token' })).status, 204);
  assert.equal((await request(`/api/restaurants/${first.id}/menu/${itemId}`, { token: 'owner-token' })).status, 404);
  assert.equal((await request(`/api/restaurants/${first.id}/menu`)).body.total, 0);
  assert.equal(items.get(itemId).deleted_at instanceof Date, true);
});

test('Auth outage and timeout fail closed with 503', async () => {
  authMode = 'unavailable';
  assert.equal((await request('/api/restaurants/mine', { token: 'owner-token' })).status, 503);
  authMode = 'slow';
  assert.equal((await request('/api/restaurants/mine', { token: 'owner-token' })).status, 503);
});