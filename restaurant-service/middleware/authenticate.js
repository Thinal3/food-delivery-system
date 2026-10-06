const { authServiceUrl, authRequestTimeoutMs } = require('../config/env');
const AppError = require('../utils/app-error');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
    return next(new AppError(401, 'A valid bearer token is required.'));
  }

  let response;
  try {
    response = await fetch(`${authServiceUrl}/api/auth/verify`, {
      method: 'GET',
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(authRequestTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return next(new AppError(503, 'Authentication service timed out.'));
    }
    return next(new AppError(503, 'Authentication service is unavailable.'));
  }

  if (response.status === 401) return next(new AppError(401, 'Authentication token is invalid or expired.'));
  if (!response.ok) {
    if (response.status >= 500) return next(new AppError(503, 'Authentication service is unavailable.'));
    return next(new AppError(502, 'Authentication service returned an unexpected response.'));
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return next(new AppError(502, 'Authentication service returned an unexpected response.'));
  }

  const user = payload?.user;
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1
    || typeof user.role !== 'string' || user.status !== 'ACTIVE') {
    return next(new AppError(502, 'Authentication service returned an unexpected response.'));
  }

  req.auth = { userId: Number(user.id), role: user.role, status: user.status };
  return next();
}

module.exports = authenticate;