const { authServiceUrl, serviceRequestTimeoutMs } = require('../config/env');
const AppError = require('../utils/app-error');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
    return next(new AppError(401, 'A valid bearer token is required.'));
  }

  let response;
  try {
    response = await fetch(`${authServiceUrl}/api/auth/verify`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(serviceRequestTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return next(new AppError(503, 'Auth service timed out.'));
    }
    return next(new AppError(503, 'Auth service is unavailable.'));
  }

  if (response.status === 401) return next(new AppError(401, 'Authentication token is invalid or expired.'));
  if (response.status >= 500) return next(new AppError(503, 'Auth service is unavailable.'));
  if (!response.ok) return next(new AppError(502, 'Auth service returned an unexpected response.'));

  let payload;
  try { payload = await response.json(); }
  catch { return next(new AppError(502, 'Auth service returned an unexpected response.')); }
  const user = payload?.user;
  const roles = ['ADMIN', 'CUSTOMER', 'RESTAURANT_ADMIN', 'DELIVERY_PERSON'];
  if (!user || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1 || Number(user.id) > 4294967295
    || !roles.includes(user.role) || user.status !== 'ACTIVE') {
    return next(new AppError(502, 'Auth service returned an unexpected identity.'));
  }

  req.auth = { userId: Number(user.id), role: user.role, status: user.status };
  req.authorization = authorization;
  return next();
}

module.exports = authenticate;