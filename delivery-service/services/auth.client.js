const { authServiceUrl } = require('../config/env');
const { getJson } = require('./http-client');
const AppError = require('../utils/app-error');

async function verifyIdentity(authorization) {
  const payload = await getJson(`${authServiceUrl}/api/auth/verify`, authorization);
  const user = payload?.user;
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1
    || !['ADMIN', 'CUSTOMER', 'RESTAURANT_ADMIN', 'DELIVERY_PERSON'].includes(user.role)
    || user.status !== 'ACTIVE') {
    throw new AppError(502, 'Auth service returned an unexpected identity.');
  }
  return { userId: Number(user.id), role: user.role, status: user.status };
}

async function isActiveDeliveryPerson(userId, authorization) {
  for (let page = 1; page <= 10000; page += 1) {
    const payload = await getJson(`${authServiceUrl}/api/auth/users?page=${page}&limit=100`, authorization);
    if (!Array.isArray(payload?.users) || !Number.isSafeInteger(Number(payload.total))) {
      throw new AppError(502, 'Auth service returned an unexpected user-list response.');
    }
    const user = payload.users.find((candidate) => Number(candidate.id ?? candidate.user_id) === userId);
    if (user) return user.role === 'DELIVERY_PERSON' && user.status === 'ACTIVE';
    if (!payload.users.length || page * 100 >= Number(payload.total)) return false;
  }
  throw new AppError(502, 'Auth user lookup exceeded its safe page limit.');
}

module.exports = { verifyIdentity, isActiveDeliveryPerson };