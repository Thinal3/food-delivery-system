const AppError = require('../utils/app-error');

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) return next(new AppError(401, 'Authentication is required.'));
    if (!roles.includes(req.auth.role)) {
      return next(new AppError(403, 'You do not have permission to perform this action.'));
    }
    return next();
  };
}

module.exports = authorizeRoles;