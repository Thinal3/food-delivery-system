const { restaurantServiceUrl } = require('../config/env');
const { getJson } = require('./http-client');
const AppError = require('../utils/app-error');

async function getRestaurant(restaurantId, authorization) {
  const payload = await getJson(`${restaurantServiceUrl}/api/restaurants/${restaurantId}`, authorization);
  const restaurant = payload?.restaurant;
  if (!restaurant || Number(restaurant.id) !== restaurantId
    || !Number.isSafeInteger(Number(restaurant.owner_user_id))
    || typeof restaurant.address !== 'string') {
    throw new AppError(502, 'Restaurant service returned an unexpected restaurant response.');
  }
  return {
    id: Number(restaurant.id), ownerUserId: Number(restaurant.owner_user_id),
    pickupAddress: {
      restaurantId: Number(restaurant.id), name: restaurant.name,
      address: restaurant.address, contactNumber: restaurant.contact_number ?? null,
    },
  };
}

module.exports = { getRestaurant };