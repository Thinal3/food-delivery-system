const AppError = require('../utils/app-error');

function validateRequest(schemas) {
  return (req, res, next) => {
    req.validated = {};

    for (const [target, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[target]);
      if (!result.success) {
        const message = result.error.issues
          .map((issue) => `${issue.path.join('.') || target}: ${issue.message}`)
          .join('; ');
        return next(new AppError(400, message));
      }
      req.validated[target] = result.data;
    }

    return next();
  };
}

module.exports = validateRequest;