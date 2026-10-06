const orders = require('../repositories/order.repository');
const customerClient = require('./customer.client');
const restaurantClient = require('./restaurant.client');
const deliveryClient = require('./delivery.client');
const { deliveryFee } = require('../config/env');
const { decimalToCents, centsToDecimal, multiplyPrice } = require('../utils/money');
const { TRANSITIONS } = require('../models/order.model');
const AppError = require('../utils/app-error');

const DELIVERY_FEE_CENTS = decimalToCents(deliveryFee, { allowZero: true });

async function create(identity, authorization, input) {
  if (identity.role !== 'CUSTOMER') throw new AppError(403, 'Only customers may place orders.');
  if (new Set(input.items.map((item) => item.menuItemId)).size !== input.items.length) {
    throw new AppError(400, 'Each menu item may appear only once; use quantity for multiples.');
  }

  // All dependency calls finish before opening the order transaction.
  const customer = await customerClient.getCustomerForUser(identity.userId, authorization);
  const address = await customerClient.getOwnedAddress(
    input.deliveryAddressId, customer.id, authorization,
  );
  const restaurant = await restaurantClient.getRestaurant(input.restaurantId, authorization, {
    unavailableAsConflict: true,
  });
  if (restaurant.status !== 'ACTIVE' || restaurant.operatingStatus !== 'OPEN') {
    throw new AppError(409, 'Restaurant is inactive or currently closed.');
  }

  const snapshots = [];
  let subtotalCents = 0n;
  for (const requested of input.items) {
    const item = await restaurantClient.getMenuItem(
      input.restaurantId, requested.menuItemId, authorization,
    );
    if (item.restaurantId !== restaurant.id || !item.availability) {
      throw new AppError(409, 'A selected menu item is unavailable or belongs to another restaurant.');
    }
    let totalCents;
    try {
      totalCents = multiplyPrice(item.price, requested.quantity);
      subtotalCents += totalCents;
      if (subtotalCents > 9999999999n) throw new RangeError('Subtotal exceeds database precision.');
    } catch {
      throw new AppError(502, 'Restaurant returned a price outside the supported money range.');
    }
    snapshots.push({
      menuItemId: item.id,
      itemName: item.name,
      quantity: requested.quantity,
      unitPrice: item.price,
      totalPrice: centsToDecimal(totalCents),
    });
  }

  const totalCents = subtotalCents + DELIVERY_FEE_CENTS;
  if (totalCents > 9999999999n) throw new AppError(400, 'Order total exceeds the supported amount.');

  try {
    const order = await orders.insertOrderWithItems({
      customerId: customer.id,
      customerUserId: identity.userId,
      restaurantId: restaurant.id,
      restaurantOwnerUserId: restaurant.ownerUserId,
      deliveryAddress: address,
      subtotal: centsToDecimal(subtotalCents),
      deliveryFee: centsToDecimal(DELIVERY_FEE_CENTS),
      totalAmount: centsToDecimal(totalCents),
    }, snapshots);
    return order;
  } catch (error) {
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.errno === 1452) {
      throw new AppError(409, 'Order could not be saved because local order data conflicted.');
    }
    throw error;
  }
}

async function listMine(identity, query) {
  if (identity.role !== 'CUSTOMER') throw new AppError(403, 'Only customers can view customer order history.');
  return orders.listForCustomer(identity.userId, query);
}

async function listRestaurant(identity, authorization, restaurantId, query) {
  await assertRestaurantOwner(identity, authorization, restaurantId);
  return orders.listForRestaurant(restaurantId, query);
}

async function listAll(identity, query) {
  if (identity.role !== 'ADMIN') throw new AppError(403, 'Only ADMIN can list all orders.');
  return orders.listAll(query);
}

async function getVisible(identity, authorization, orderId) {
  const order = await orders.findById(orderId);
  if (!order) throw new AppError(404, 'Order not found.');
  await assertCanView(identity, authorization, order);
  return order;
}

async function assertCanView(identity, authorization, order) {
  if (identity.role === 'ADMIN') return;
  if (identity.role === 'CUSTOMER') {
    if (Number(order.customer_user_id) !== identity.userId) throw new AppError(403, 'You cannot access this order.');
    return;
  }
  if (identity.role === 'RESTAURANT_ADMIN') {
    await assertRestaurantOwner(identity, authorization, Number(order.restaurant_id));
    return;
  }
  if (identity.role === 'DELIVERY_PERSON') {
    await deliveryClient.assertAssigned(Number(order.id), identity.userId, authorization);
    return;
  }
  throw new AppError(403, 'You do not have permission to access orders.');
}

async function assertRestaurantOwner(identity, authorization, restaurantId) {
  if (identity.role === 'ADMIN') return;
  if (identity.role !== 'RESTAURANT_ADMIN') throw new AppError(403, 'Restaurant ownership is required.');
  const restaurant = await restaurantClient.getRestaurant(restaurantId, authorization);
  if (restaurant.ownerUserId !== identity.userId) {
    throw new AppError(403, 'You do not own this restaurant.');
  }
}

async function changeStatus(identity, authorization, orderId, nextStatus) {
  const order = await orders.findById(orderId);
  if (!order) throw new AppError(404, 'Order not found.');
  const current = order.status;
  if (!TRANSITIONS[current]?.includes(nextStatus)) {
    throw new AppError(409, 'This order status transition is not allowed.');
  }

  if (identity.role === 'ADMIN') {
    // Admin can intervene but still must follow one edge in the lifecycle graph.
  } else if (identity.role === 'RESTAURANT_ADMIN') {
    await assertRestaurantOwner(identity, authorization, Number(order.restaurant_id));
    if (nextStatus === 'CANCELLED') {
      if (!['PENDING', 'CONFIRMED', 'PREPARING'].includes(current)) {
        throw new AppError(409, 'Restaurant cancellation is only allowed before pickup.');
      }
    } else if (!['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'].includes(nextStatus)) {
      throw new AppError(403, 'Restaurant owners cannot perform delivery status updates.');
    }
  } else if (identity.role === 'DELIVERY_PERSON') {
    if (!['PICKED_UP', 'ON_THE_WAY', 'DELIVERED'].includes(nextStatus)) {
      throw new AppError(403, 'Delivery personnel cannot perform this status update.');
    }
    await deliveryClient.assertAssigned(orderId, identity.userId, authorization);
  } else {
    throw new AppError(403, 'Customers cannot update order status.');
  }

  if (['PICKED_UP', 'ON_THE_WAY', 'DELIVERED'].includes(nextStatus)) {
    const persistedDelivery = await deliveryClient.getPersistedStatus(orderId);
    if (persistedDelivery.status !== nextStatus
      || (identity.role === 'DELIVERY_PERSON'
        && Number(persistedDelivery.delivery_person_id) !== identity.userId)) {
      throw new AppError(409, 'Delivery must persist this status and assignment before Order can synchronize it.');
    }
  }

  if (!(await orders.transitionIfCurrent(orderId, current, nextStatus))) {
    throw new AppError(409, 'Order changed concurrently; reload it before trying again.');
  }
  return orders.findById(orderId);
}

async function cancel(identity, authorization, orderId) {
  const order = await orders.findById(orderId);
  if (!order) throw new AppError(404, 'Order not found.');
  if (identity.role === 'CUSTOMER') {
    if (Number(order.customer_user_id) !== identity.userId) throw new AppError(403, 'You cannot cancel this order.');
    if (order.status !== 'PENDING') throw new AppError(409, 'Customers may cancel only PENDING orders.');
  } else if (identity.role === 'RESTAURANT_ADMIN') {
    await assertRestaurantOwner(identity, authorization, Number(order.restaurant_id));
    if (!['PENDING', 'CONFIRMED', 'PREPARING'].includes(order.status)) {
      throw new AppError(409, 'This order can no longer be cancelled.');
    }
  } else if (identity.role === 'ADMIN') {
    if (!['PENDING', 'CONFIRMED', 'PREPARING'].includes(order.status)) {
      throw new AppError(409, 'ADMIN cannot cancel an order after pickup.');
    }
  } else if (identity.role === 'DELIVERY_PERSON') {
    throw new AppError(403, 'Delivery personnel cannot cancel orders.');
  } else {
    throw new AppError(403, 'You cannot cancel this order.');
  }

  if (!(await orders.transitionIfCurrent(orderId, order.status, 'CANCELLED'))) {
    throw new AppError(409, 'Order changed concurrently; reload it before trying again.');
  }
  return orders.findById(orderId);
}

async function syncDeliveryStatus({ orderId, deliveryId, status }) {
  if (!['PICKED_UP', 'ON_THE_WAY', 'DELIVERED'].includes(status)) {
    throw new AppError(400, 'Only delivery progress statuses can synchronize to Order.');
  }
  const delivery = await deliveryClient.getPersistedStatus(orderId, deliveryId);
  if (delivery.status !== status) {
    throw new AppError(409, 'Delivery status does not match the persisted Delivery record.');
  }
  const order = await orders.findById(orderId);
  if (!order) throw new AppError(404, 'Order not found.');
  if (order.status === status) return order;
  if (!TRANSITIONS[order.status]?.includes(status)) {
    throw new AppError(409, 'Order cannot make this delivery status transition.');
  }
  if (!(await orders.transitionIfCurrent(orderId, order.status, status))) {
    const current = await orders.findById(orderId);
    if (current?.status === status) return current;
    throw new AppError(409, 'Order changed concurrently during Delivery synchronization.');
  }
  return orders.findById(orderId);
}

module.exports = { create, listMine, listRestaurant, listAll, getVisible, changeStatus, cancel, syncDeliveryStatus };