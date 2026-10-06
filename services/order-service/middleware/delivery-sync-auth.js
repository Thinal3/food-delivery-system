const { timingSafeEqual } = require('node:crypto');
const { orderDeliverySyncSecret } = require('../config/env');
const AppError = require('../utils/app-error');

function deliverySyncAuth(req, res, next) {
  if (!orderDeliverySyncSecret) return next(new AppError(503, 'Delivery synchronization is not configured.'));
  const header = req.get('authorization') || '';
  const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(orderDeliverySyncSecret);
  const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
  if (!matches) return next(new AppError(401, 'Delivery service authentication is required.'));
  return next();
}

module.exports = deliverySyncAuth;