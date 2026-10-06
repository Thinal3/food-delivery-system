const repository = require('../repositories/delivery.repository');
const authClient = require('./auth.client');
const orderClient = require('./order.client');
const restaurantClient = require('./restaurant.client');
const { TRANSITIONS } = require('../models/delivery.model');
const AppError = require('../utils/app-error');

async function create(identity, authorization, orderId) {
  if (!['ADMIN', 'RESTAURANT_ADMIN'].includes(identity.role)) {
    throw new AppError(403, 'Only ADMIN or the restaurant owner can create a delivery.');
  }
  const order = await orderClient.getOrder(orderId, authorization);
  if (order.status !== 'READY_FOR_PICKUP') throw new AppError(409, 'Order is not READY_FOR_PICKUP.');
  if (identity.role === 'RESTAURANT_ADMIN') {
    const restaurant = await restaurantClient.getRestaurant(order.restaurantId, authorization);
    if (restaurant.ownerUserId !== identity.userId) throw new AppError(403, 'You do not own this restaurant.');
  }
  const restaurant = await restaurantClient.getRestaurant(order.restaurantId, authorization);
  try {
    return await repository.create({
      orderId: order.id,
      restaurantId: order.restaurantId,
      customerId: order.customerId,
      customerUserId: order.customerUserId,
      restaurantOwnerUserId: order.restaurantOwnerUserId ?? restaurant.ownerUserId,
      pickupAddress: restaurant.pickupAddress,
      deliveryAddress: order.deliveryAddress,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new AppError(409, 'A delivery already exists for this order.');
    }
    throw error;
  }
}

async function assign(identity, authorization, deliveryId, deliveryPersonId) {
  if (identity.role !== 'ADMIN') throw new AppError(403, 'Only ADMIN can assign delivery personnel.');
  if (!(await authClient.isActiveDeliveryPerson(deliveryPersonId, authorization))) {
    throw new AppError(400, 'deliveryPersonId must identify an active DELIVERY_PERSON.');
  }
  const result = await repository.updateAssignment(deliveryId, deliveryPersonId, ['PENDING', 'ASSIGNED', 'PICKUP_PENDING']);
  if (result.notFound) throw new AppError(404, 'Delivery not found.');
  if (result.conflict) throw new AppError(409, 'Delivery cannot be assigned or reassigned after pickup.');
  return result.delivery;
}

async function listMine(identity, query) {
  if (identity.role === 'DELIVERY_PERSON') return repository.listForPerson(identity.userId, query);
  if (identity.role === 'CUSTOMER') return repository.listForCustomer(identity.userId, query);
  if (identity.role === 'ADMIN') return repository.listAll(query);
  throw new AppError(403, 'This role does not have a personal delivery list.');
}

async function listForOrder(identity, authorization, orderId) {
  const delivery = await repository.findByOrderId(orderId);
  if (!delivery) throw new AppError(404, 'Delivery not found for this order.');
  await assertCanView(identity, authorization, delivery);
  return delivery;
}

async function listRestaurant(identity, authorization, restaurantId, query) {
  await assertRestaurantOwner(identity, authorization, restaurantId);
  return repository.listForRestaurant(restaurantId, query);
}

async function listAll(identity, query) {
  if (identity.role !== 'ADMIN') throw new AppError(403, 'Only ADMIN can list all deliveries.');
  return repository.listAll(query);
}

async function get(identity, authorization, deliveryId) {
  const delivery = await repository.findById(deliveryId);
  if (!delivery) throw new AppError(404, 'Delivery not found.');
  await assertCanView(identity, authorization, delivery);
  return delivery;
}

async function assertCanView(identity, authorization, delivery) {
  if (identity.role === 'ADMIN') return;
  if (identity.role === 'DELIVERY_PERSON') {
    if (Number(delivery.delivery_person_id) !== identity.userId) throw new AppError(403, 'Delivery is not assigned to you.');
    return;
  }
  if (identity.role === 'RESTAURANT_ADMIN') {
    await assertRestaurantOwner(identity, authorization, Number(delivery.restaurant_id));
    return;
  }
  if (identity.role === 'CUSTOMER') {
    if (Number(delivery.customer_user_id) !== identity.userId) throw new AppError(403, 'You cannot access this delivery.');
    return;
  }
  throw new AppError(403, 'You do not have permission to access deliveries.');
}

async function assertRestaurantOwner(identity, authorization, restaurantId) {
  if (identity.role === 'ADMIN') return;
  if (identity.role !== 'RESTAURANT_ADMIN') throw new AppError(403, 'Restaurant ownership is required.');
  const restaurant = await restaurantClient.getRestaurant(restaurantId, authorization);
  if (restaurant.ownerUserId !== identity.userId) throw new AppError(403, 'You do not own this restaurant.');
}

async function changeStatus(identity, authorization, deliveryId, nextStatus, failureReason) {
  if (nextStatus === 'ASSIGNED') {
    throw new AppError(409, 'Use the ADMIN assignment endpoint to assign a delivery person.');
  }
  const delivery = await repository.findById(deliveryId);
  if (!delivery) throw new AppError(404, 'Delivery not found.');
  if (!TRANSITIONS[delivery.status]?.includes(nextStatus)) throw new AppError(409, 'This delivery status transition is not allowed.');

  if (identity.role === 'ADMIN') {
    // ADMIN may intervene, but still follows one edge in the lifecycle graph.
  } else if (identity.role === 'RESTAURANT_ADMIN') {
    await assertRestaurantOwner(identity, authorization, Number(delivery.restaurant_id));
    if (nextStatus !== 'CANCELLED' || !['PENDING', 'ASSIGNED', 'PICKUP_PENDING'].includes(delivery.status)) {
      throw new AppError(403, 'Restaurant owners may only cancel before pickup.');
    }
  } else if (identity.role === 'DELIVERY_PERSON') {
    if (Number(delivery.delivery_person_id) !== identity.userId) throw new AppError(403, 'Delivery is not assigned to you.');
    if (!['ASSIGNED', 'PICKUP_PENDING', 'PICKED_UP', 'ON_THE_WAY'].includes(delivery.status)) {
      throw new AppError(409, 'Delivery must be assigned and accepted before progress or failure updates.');
    }
  } else {
    throw new AppError(403, 'This role cannot update delivery status.');
  }

  if (nextStatus === 'FAILED' && !failureReason?.trim()) {
    throw new AppError(400, 'failureReason is required when marking a delivery FAILED.');
  }
  if (nextStatus === 'CANCELLED' && !['PENDING', 'ASSIGNED', 'PICKUP_PENDING'].includes(delivery.status)) {
    throw new AppError(409, 'Delivery cannot be cancelled after pickup.');
  }

  const result = await repository.transition(deliveryId, nextStatus, {
    expectedStatus: delivery.status,
    failureReason: failureReason?.trim() || null,
  });
  if (result.notFound) throw new AppError(404, 'Delivery not found.');
  if (result.conflict) throw new AppError(409, 'Delivery changed concurrently; reload it and retry.');
  return result.delivery;
}

async function cancel(identity, authorization, deliveryId) {
  return changeStatus(identity, authorization, deliveryId, 'CANCELLED');
}

module.exports = { create, assign, listMine, listForOrder, listRestaurant, listAll, get, changeStatus, cancel, assertCanView };