const { restaurantServiceUrl } = require('../config/env');
const { getJson } = require('./http-client');
const AppError = require('../utils/app-error');

async function getRestaurant(restaurantId, authorization, { unavailableAsConflict = false } = {}) {
  const payload = await getJson(`${restaurantServiceUrl}/api/restaurants/${restaurantId}`, authorization);
  if (!payload) {
    if (unavailableAsConflict) throw new AppError(409, 'Restaurant is inactive or unavailable for ordering.');
    throw new AppError(404, 'Restaurant not found.');
  }
  const restaurant = payload?.restaurant;
  if (!restaurant || Number(restaurant.id) !== restaurantId
    || !Number.isSafeInteger(Number(restaurant.owner_user_id))
    || !['ACTIVE', 'INACTIVE'].includes(restaurant.status)
    || !['OPEN', 'CLOSED'].includes(restaurant.operating_status)) {
    throw new AppError(502, 'Restaurant service returned an unexpected restaurant response.');
  }
  return {
    id: Number(restaurant.id),
    ownerUserId: Number(restaurant.owner_user_id),
    status: restaurant.status,
    operatingStatus: restaurant.operating_status,
  };
}

async function getMenuItem(restaurantId, itemId, authorization) {
  const payload = await getJson(
    `${restaurantServiceUrl}/api/restaurants/${restaurantId}/menu/${itemId}`,
    authorization,
  );
  if (!payload) throw new AppError(409, 'A selected menu item is no longer available.');
  const item = payload?.item;
  if (!item || Number(item.id) !== itemId || Number(item.restaurant_id) !== restaurantId
    || typeof item.name !== 'string' || typeof item.price !== 'string'
    || ![true, false, 0, 1].includes(item.availability)) {
    throw new AppError(502, 'Restaurant service returned an unexpected menu item response.');
  }
  return { id: Number(item.id), restaurantId: Number(item.restaurant_id), name: item.name,
    price: item.price, availability: item.availability === true || item.availability === 1 };
}

module.exports = { getRestaurant, getMenuItem };