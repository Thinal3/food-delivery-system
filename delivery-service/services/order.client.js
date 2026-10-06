const { orderServiceUrl, serviceRequestTimeoutMs, orderDeliverySyncSecret } = require('../config/env');
const { getJson } = require('./http-client');
const AppError = require('../utils/app-error');

async function getOrder(orderId, authorization) {
  const payload = await getJson(`${orderServiceUrl}/api/orders/${orderId}`, authorization);
  if (!payload) throw new AppError(404, 'Order not found.');
  const order = payload?.order;
  if (!order || Number(order.id) !== orderId
    || !Number.isSafeInteger(Number(order.restaurant_id))
    || !Number.isSafeInteger(Number(order.customer_id))
    || !Number.isSafeInteger(Number(order.customer_user_id))
    || !['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED'].includes(order.status)
    || !order.delivery_address || typeof order.delivery_address !== 'object') {
    throw new AppError(502, 'Order service returned an unexpected order response.');
  }
  return {
    id: Number(order.id), status: order.status,
    restaurantId: Number(order.restaurant_id),
    customerId: Number(order.customer_id),
    customerUserId: Number(order.customer_user_id),
    restaurantOwnerUserId: order.restaurant_owner_user_id == null ? null : Number(order.restaurant_owner_user_id),
    deliveryAddress: order.delivery_address,
  };
}

async function updateOrderStatusFromDelivery(orderId, deliveryId, status) {
  let response;
  try {
    response = await fetch(`${orderServiceUrl}/api/orders/internal/delivery-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${orderDeliverySyncSecret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ orderId, deliveryId, status }),
      signal: AbortSignal.timeout(serviceRequestTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new AppError(503, 'Order status sync timed out.');
    throw new AppError(503, 'Order service is unavailable for status sync.');
  }
  if (response.status === 404) throw new AppError(404, 'Order or Delivery was not found during synchronization.');
  if (response.status === 409) throw new AppError(409, 'Order status synchronization conflicted.');
  if (response.status >= 500) throw new AppError(503, 'Order service is unavailable for status sync.');
  if (!response.ok) throw new AppError(502, 'Order service rejected the delivery synchronization request.');
}

module.exports = { getOrder, updateOrderStatusFromDelivery };