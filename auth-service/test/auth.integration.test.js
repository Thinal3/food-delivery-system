process.env.JWT_SECRET ||= 'test-signing-secret-with-at-least-32-characters';
process.env.JWT_ISSUER ||= 'auth-service-test';
process.env.JWT_AUDIENCE ||= 'food-delivery-services-test';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_PORT ||= '3307';
process.env.DB_USER ||= 'test-user';
process.env.DB_PASSWORD ||= 'test-password';
process.env.DB_NAME ||= 'auth_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../app');
const users = require('../repositories/user.repository');
const { jwtSecret, jwtIssuer, jwtAudience } = require('../config/env');

let server;
let baseUrl;
let userRows;
let nextUserId;
const originalRepository = {};

function publicRow(row) {
  const { password_hash, ...safeRow } = row;
  return safeRow;
}

function findByEmail(email) {
  return [...userRows.values()].find((user) => user.email === email) || null;
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
  const payload = await response.json();
  assert.equal(JSON.stringify(payload).includes('password_hash'), false);
  return { status: response.status, body: payload };
}

function issueToken(userId, options = {}) {
  return jwt.sign({}, jwtSecret, {
    algorithm: 'HS256',
    subject: String(userId),
    issuer: options.issuer || jwtIssuer,
    audience: options.audience || jwtAudience,
    expiresIn: options.expiresIn || '5m',
  });
}

async function createFixtureUser({
  name = 'Test User',
  email = `user-${nextUserId}@example.test`,
  password = 'correct-password',
  role = 'CUSTOMER',
  status = 'ACTIVE',
} = {}) {
  const passwordHash = await bcrypt.hash(password, 4);
  const id = nextUserId++;
  const row = {
    user_id: id,
    full_name: name,
    email,
    password_hash: passwordHash,
    role,
    status,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
  userRows.set(id, row);
  return row;
}

test.before(async () => {
  const methods = {
    findByEmail: async (email) => findByEmail(email),
    findPublicById: async (userId) => {
      const row = userRows.get(Number(userId));
      return row ? publicRow(row) : null;
    },
    create: async ({ fullName, email, passwordHash, role, status }) => {
      if (findByEmail(email)) {
        const error = new Error('duplicate key');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      const row = {
        user_id: nextUserId++,
        full_name: fullName,
        email,
        password_hash: passwordHash,
        role,
        status,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      };
      userRows.set(row.user_id, row);
      return publicRow(row);
    },
    listPaginated: async (page, limit) => ({
      users: [...userRows.values()]
        .slice((page - 1) * limit, page * limit)
        .map(publicRow),
      page,
      limit,
      total: userRows.size,
    }),
    updateRole: async (userId, role) => {
      const row = userRows.get(Number(userId));
      if (!row) return { notFound: true };
      const activeAdmins = [...userRows.values()].filter(
        (user) => user.role === 'ADMIN' && user.status === 'ACTIVE',
      );
      if (row.role === 'ADMIN' && row.status === 'ACTIVE'
        && role !== 'ADMIN' && activeAdmins.length <= 1) {
        return { lastActiveAdmin: true };
      }
      row.role = role;
      return { user: publicRow(row) };
    },
    updateStatus: async (userId, status) => {
      const row = userRows.get(Number(userId));
      if (!row) return { notFound: true };
      const activeAdmins = [...userRows.values()].filter(
        (user) => user.role === 'ADMIN' && user.status === 'ACTIVE',
      );
      if (row.role === 'ADMIN' && row.status === 'ACTIVE'
        && status !== 'ACTIVE' && activeAdmins.length <= 1) {
        return { lastActiveAdmin: true };
      }
      row.status = status;
      return { user: publicRow(row) };
    },
  };

  for (const [name, implementation] of Object.entries(methods)) {
    originalRepository[name] = users[name];
    users[name] = implementation;
  }

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.beforeEach(() => {
  userRows = new Map();
  nextUserId = 1;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [name, implementation] of Object.entries(originalRepository)) {
    users[name] = implementation;
  }
});

test('registration creates an active customer and never returns a password hash', async () => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { name: '  Taylor User ', email: ' TAYLOR@example.test ', password: 'correct-password' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.user.name, 'Taylor User');
  assert.equal(response.body.user.email, 'taylor@example.test');
  assert.equal(response.body.user.role, 'CUSTOMER');
  assert.equal(response.body.user.status, 'ACTIVE');
  assert.equal(typeof response.body.token, 'string');
  assert.equal(Object.hasOwn(response.body.user, 'password_hash'), false);
});

test('duplicate email, invalid input, and public privileged registration are rejected', async () => {
  const body = { name: 'Taylor User', email: 'taylor@example.test', password: 'correct-password' };
  assert.equal((await request('/api/auth/register', { method: 'POST', body })).status, 201);
  assert.equal((await request('/api/auth/register', { method: 'POST', body })).status, 409);
  assert.equal((await request('/api/auth/register', {
    method: 'POST',
    body: { ...body, role: 'ADMIN' },
  })).status, 400);
  assert.equal((await request('/api/auth/register', {
    method: 'POST',
    body: { ...body, password: 'short' },
  })).status, 400);
});

test('login checks bcrypt password, rejects bad credentials, and rejects inactive accounts', async () => {
  const active = await createFixtureUser({ email: 'active@example.test' });
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: active.email, password: 'correct-password' },
  });
  assert.equal(login.status, 200);
  assert.equal(Object.hasOwn(login.body.user, 'password_hash'), false);
  assert.equal((await request('/api/auth/login', {
    method: 'POST',
    body: { email: active.email, password: 'wrong-password' },
  })).status, 401);
  await createFixtureUser({ email: 'inactive@example.test', status: 'INACTIVE' });
  const inactive = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'inactive@example.test', password: 'correct-password' },
  });
  assert.equal(inactive.status, 401);
  assert.equal(inactive.body.error, 'Invalid email or password.');
});

test('protected identity endpoints reject missing, malformed, expired, tampered, or wrongly scoped tokens', async () => {
  const user = await createFixtureUser();
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/auth/me', { token: 'not-a-jwt' })).status, 401);
  assert.equal((await request('/api/auth/me', { token: issueToken(user.user_id, { expiresIn: '-1s' }) })).status, 401);
  assert.equal((await request('/api/auth/me', { token: issueToken(user.user_id, { audience: 'wrong-service' }) })).status, 401);
  const noExpiryToken = jwt.sign({}, jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.user_id),
    issuer: jwtIssuer,
    audience: jwtAudience,
  });
  assert.equal((await request('/api/auth/me', { token: noExpiryToken })).status, 401);
  const token = issueToken(user.user_id);
  const parts = token.split('.');
  parts[2] = `${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`;
  assert.equal((await request('/api/auth/me', { token: parts.join('.') })).status, 401);
});

test('/me and /verify return current safe identity; an inactive account loses token access', async () => {
  const user = await createFixtureUser({ email: 'identity@example.test' });
  const token = issueToken(user.user_id);
  for (const path of ['/api/auth/me', '/api/auth/verify']) {
    const response = await request(path, { token });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, user.email);
    assert.equal(Object.hasOwn(response.body.user, 'password_hash'), false);
  }
  user.status = 'INACTIVE';
  assert.equal((await request('/api/auth/verify', { token })).status, 401);
});

test('only admins may use admin routes and the current database role controls access', async () => {
  const customer = await createFixtureUser({ email: 'customer@example.test' });
  const customerToken = issueToken(customer.user_id);
  assert.equal((await request('/api/auth/users', { token: customerToken })).status, 403);
  assert.equal((await request('/api/auth/users')).status, 401);

  const admin = await createFixtureUser({ email: 'admin@example.test', role: 'ADMIN' });
  const adminToken = issueToken(admin.user_id);
  const created = await request('/api/auth/users', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Restaurant Staff',
      email: 'staff@example.test',
      password: 'correct-password',
      role: 'RESTAURANT_ADMIN',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, 'RESTAURANT_ADMIN');
  assert.equal(Object.hasOwn(created.body.user, 'password_hash'), false);

  const list = await request('/api/auth/users?page=1&limit=5', { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.users.some((entry) => Object.hasOwn(entry, 'password_hash')), false);

  const roleChange = await request(`/api/auth/users/${customer.user_id}/role`, {
    method: 'PATCH', token: adminToken, body: { role: 'ADMIN' },
  });
  assert.equal(roleChange.status, 200);
  assert.equal((await request('/api/auth/users', { token: customerToken })).status, 200);

  const statusChange = await request(`/api/auth/users/${customer.user_id}/status`, {
    method: 'PATCH', token: adminToken, body: { status: 'INACTIVE' },
  });
  assert.equal(statusChange.status, 200);
  assert.equal((await request('/api/auth/users', { token: customerToken })).status, 401);
});

test('admin changes cannot remove the final active admin', async () => {
  const admin = await createFixtureUser({ role: 'ADMIN' });
  const token = issueToken(admin.user_id);
  assert.equal((await request(`/api/auth/users/${admin.user_id}/role`, {
    method: 'PATCH', token, body: { role: 'CUSTOMER' },
  })).status, 409);
  assert.equal((await request(`/api/auth/users/${admin.user_id}/status`, {
    method: 'PATCH', token, body: { status: 'INACTIVE' },
  })).status, 409);
});