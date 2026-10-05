const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn, jwtIssuer, jwtAudience } = require('../config/env');
const users = require('../repositories/user.repository');
const AppError = require('../utils/app-error');
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-only-invalid-account-password', 12);

function normalizeEmail(email) {
  // Use the same canonical form for registration and later account lookups.
  return email.trim().toLowerCase();
}

function publicUser(user) {
  // Keep internal credential fields out of every API response.
  return {
    id: Number(user.user_id),
    name: user.full_name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
  };
}

function createToken(user) {
  return jwt.sign(
    {},
    jwtSecret,
    {
      algorithm: 'HS256',
      subject: String(user.user_id),
      issuer: jwtIssuer,
      audience: jwtAudience,
      expiresIn: jwtExpiresIn,
    },
  );
}

async function createAccount({ name, email, password, role = 'CUSTOMER', status = 'ACTIVE' }) {
  const normalizedEmail = normalizeEmail(email);
  if (await users.findByEmail(normalizedEmail)) {
    throw new AppError(409, 'An account with this email already exists.');
  }

  let user;
  try {
    // Hash before persistence; only the one-way bcrypt hash is stored.
    user = await users.create({
      fullName: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      status,
    });
  } catch (error) {
    // The UNIQUE index handles two simultaneous registrations for the same email.
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new AppError(409, 'An account with this email already exists.');
    }
    throw error;
  }

  return { user: publicUser(user), token: createToken(user) };
}

async function register({ name, email, password }) {
  // Public registration intentionally accepts no role or status fields.
  return createAccount({ name, email, password, role: 'CUSTOMER', status: 'ACTIVE' });
}

async function login({ email, password }) {
  const user = await users.findByEmail(normalizeEmail(email));
  const passwordMatches = user
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches || user.status !== 'ACTIVE') {
    throw new AppError(401, 'Invalid email or password.');
  }

  return { user: publicUser(user), token: createToken(user) };
}

async function getCurrentUser(userId) {
  const user = await users.findPublicById(userId);
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(401, 'Authentication is invalid or the account is inactive.');
  }
  return publicUser(user);
}

async function createAdminManagedAccount(input) {
  const result = await createAccount(input);
  return result.user;
}

async function listUsers(page, limit) {
  return users.listPaginated(page, limit);
}

async function updateUserRole(userId, role) {
  const result = await users.updateRole(userId, role);
  if (result.notFound) throw new AppError(404, 'User not found.');
  if (result.lastActiveAdmin) {
    throw new AppError(409, 'The final active ADMIN cannot be demoted.');
  }
  return publicUser(result.user);
}

async function updateUserStatus(userId, status) {
  const result = await users.updateStatus(userId, status);
  if (result.notFound) throw new AppError(404, 'User not found.');
  if (result.lastActiveAdmin) {
    throw new AppError(409, 'The final active ADMIN cannot be deactivated.');
  }
  return publicUser(result.user);
}

module.exports = {
  register,
  login,
  getCurrentUser,
  createAdminManagedAccount,
  listUsers,
  updateUserRole,
  updateUserStatus,
  publicUser,
};