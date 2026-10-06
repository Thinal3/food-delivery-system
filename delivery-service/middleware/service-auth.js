const { timingSafeEqual } = require('node:crypto');
const { orderDeliverySyncSecret } = require('../config/env');
const AppError = require('../utils/app-error');

function serviceAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expectedBuffer = Buffer.from(orderDeliverySyncSecret);
  const providedBuffer = Buffer.from(provided);
  const valid = providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
  if (!valid) return next(new AppError(401, 'Service authentication is required.'));
  return next();
}

module.exports = serviceAuth;