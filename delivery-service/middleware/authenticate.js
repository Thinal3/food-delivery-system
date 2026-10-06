const authClient = require('../services/auth.client');
const AppError = require('../utils/app-error');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) return next(new AppError(401, 'A valid bearer token is required.'));
  try {
    req.auth = await authClient.verifyIdentity(authorization);
    req.authorization = authorization;
    return next();
  } catch (error) { return next(error); }
}

module.exports = authenticate;