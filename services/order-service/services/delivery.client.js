const { deliveryServiceUrl, orderDeliverySyncSecret } = require('../config/env');
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
  return { deliveryId: Number(assignment.delivery_id), assignment };
}

async function getPersistedStatus(orderId, deliveryId) {
  if (!orderDeliverySyncSecret) throw new AppError(503, 'Delivery status verification is not configured.');
  const payload = await getJson(
    `${deliveryServiceUrl}/api/deliveries/internal/orders/${orderId}/status`,
    `Bearer ${orderDeliverySyncSecret}`,
  );
  const delivery = payload?.delivery;
  if (!delivery || Number(delivery.order_id) !== orderId
    || (deliveryId !== undefined && Number(delivery.id) !== deliveryId)) {
    throw new AppError(409, 'Persisted Delivery record does not match this Order.');
  }
  return delivery;
}

module.exports = { assertAssigned, getPersistedStatus };