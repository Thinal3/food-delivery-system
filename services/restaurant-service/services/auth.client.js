const { authServiceUrl, authRequestTimeoutMs } = require('../config/env');
const AppError = require('../utils/app-error');

async function requestAuth(path, authorization) {
  let response;
  try {
    response = await fetch(`${authServiceUrl}${path}`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(authRequestTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new AppError(503, 'Authentication service timed out.');
    }
    throw new AppError(503, 'Authentication service is unavailable.');
  }

  if (response.status === 401) throw new AppError(401, 'Authentication token is invalid or expired.');
  if (!response.ok) {
    if (response.status >= 500) throw new AppError(503, 'Authentication service is unavailable.');
    throw new AppError(502, 'Authentication service returned an unexpected response.');
  }

  try {
    return await response.json();
  } catch {
    throw new AppError(502, 'Authentication service returned an unexpected response.');
  }
}

async function findActiveRestaurantAdmin(userId, authorization) {
  for (let page = 1; page <= 10000; page += 1) {
    const payload = await requestAuth(`/api/auth/users?page=${page}&limit=100`, authorization);
    if (!Array.isArray(payload.users) || !Number.isSafeInteger(Number(payload.total))) {
      throw new AppError(502, 'Authentication service returned an unexpected response.');
    }
    const user = payload.users.find((candidate) => Number(candidate.id ?? candidate.user_id) === userId);
    if (user) return user.role === 'RESTAURANT_ADMIN' && user.status === 'ACTIVE';
    if (page * 100 >= Number(payload.total) || payload.users.length === 0) return false;
  }
  throw new AppError(502, 'Authentication user lookup exceeded its safe limit.');
}

module.exports = { requestAuth, findActiveRestaurantAdmin };