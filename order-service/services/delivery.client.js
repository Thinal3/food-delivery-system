const { deliveryServiceUrl } = require('../config/env');
const { getJson } = require('./http-client');
const AppError = require('../utils/app-error');

async function assertAssigned(orderId, deliveryUserId, authorization) {
  const payload = await getJson(
    `${deliveryServiceUrl}/api/deliveries/me/orders/${orderId}/assignment`,
    authorization,
  );
  const assignment = payload?.assignment;
  if (!assignment || Number(assignment.order_id) !== orderId
    || Number(assignment.delivery_person_user_id) !== deliveryUserId
    || assignment.status !== 'ACTIVE') {
    throw new AppError(403, 'This order is not assigned to you.');
  }
}

module.exports = { assertAssigned };