const authenticate = require('./authenticate');

function optionalAuthenticate(req, res, next) {
  if (!req.get('authorization')) return next();
  return authenticate(req, res, next);
}

module.exports = optionalAuthenticate;