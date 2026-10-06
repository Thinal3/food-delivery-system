const { authServiceUrl } = require('../config/env');
const { getJson } = require('./http-client');
const AppError = require('../utils/app-error');

async function verifyIdentity(authorization) {
  const payload = await getJson(`${authServiceUrl}/api/auth/verify`, authorization);
  const user = payload?.user;
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1
    || !['ADMIN', 'CUSTOMER', 'RESTAURANT_ADMIN', 'DELIVERY_PERSON'].includes(user.role)
    || user.status !== 'ACTIVE') {
    throw new AppError(502, 'Auth returned an unexpected identity response.');
  }
  return { userId: Number(user.id), role: user.role, status: user.status };
}

module.exports = { verifyIdentity };