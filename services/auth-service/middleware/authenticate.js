const jwt = require('jsonwebtoken');
const { jwtSecret, jwtIssuer, jwtAudience } = require('../config/env');
const users = require('../repositories/user.repository');
const { publicUser } = require('../services/auth.service');
const AppError = require('../utils/app-error');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
    return next(new AppError(401, 'A valid bearer token is required.'));
  }

  try {
    // Check all trusted JWT properties, then use only its subject to reload current account state.
    const payload = jwt.verify(authorization.slice(7), jwtSecret, {
      algorithms: ['HS256'],
      issuer: jwtIssuer,
      audience: jwtAudience,
    });
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) {
      throw new AppError(401, 'Authentication token is invalid or expired.');
    }
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      throw new AppError(401, 'Authentication token is invalid.');
    }

    const user = await users.findPublicById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError(401, 'Authentication is invalid or the account is inactive.');
    }

    req.auth = publicUser(user);
    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new AppError(401, 'Authentication token is invalid or expired.'));
    }
    return next(error);
  }
}

module.exports = authenticate;