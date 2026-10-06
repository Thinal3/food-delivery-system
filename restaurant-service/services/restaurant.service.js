const restaurants = require('../repositories/restaurant.repository');
const { findActiveRestaurantAdmin } = require('./auth.client');
const AppError = require('../utils/app-error');

async function listPublic(query) {
  return restaurants.listPublic(query);
}

async function listMine(auth, query) {
  if (auth.role === 'ADMIN') return restaurants.listAll(query.page, query.limit);
  return restaurants.listMine(auth.userId, query.page, query.limit);
}

async function create(auth, authorization, input) {
  let ownerUserId;
  if (auth.role === 'RESTAURANT_ADMIN') {
    if (input.ownerUserId !== undefined) {
      throw new AppError(400, 'RESTAURANT_ADMIN cannot choose ownerUserId.');
    }
    ownerUserId = auth.userId;
  } else if (auth.role === 'ADMIN') {
    if (!input.ownerUserId) throw new AppError(400, 'ADMIN must provide ownerUserId.');
    if (!(await findActiveRestaurantAdmin(input.ownerUserId, authorization))) {
      throw new AppError(400, 'ownerUserId must identify an active RESTAURANT_ADMIN.');
    }
    ownerUserId = input.ownerUserId;
  } else {
    throw new AppError(403, 'You do not have permission to create a restaurant.');
  }

  try {
    return await restaurants.create({ ...input, ownerUserId });
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

async function getById(id, auth) {
  const restaurant = await restaurants.findById(id);
  if (!restaurant || restaurant.status !== 'ACTIVE') {
    if (!auth) throw new AppError(404, 'Restaurant not found.');
    if (!restaurant || (auth.role !== 'ADMIN'
      && !(auth.role === 'RESTAURANT_ADMIN' && Number(restaurant.owner_user_id) === auth.userId))) {
      throw new AppError(404, 'Restaurant not found.');
    }
  }
  return restaurant;
}

async function update(id, input) {
  try {
    const restaurant = await restaurants.update(id, input);
    if (!restaurant) throw new AppError(404, 'Restaurant not found.');
    return restaurant;
  } catch (error) {
    throw translateDatabaseError(error);
  }
}

async function setStatus(id, status) {
  const restaurant = await restaurants.setStatus(id, status);
  if (!restaurant) throw new AppError(404, 'Restaurant not found.');
  return restaurant;
}

async function setOperatingStatus(id, operatingStatus) {
  const restaurant = await restaurants.setOperatingStatus(id, operatingStatus);
  if (!restaurant) throw new AppError(404, 'Restaurant not found.');
  return restaurant;
}

async function deactivate(id) {
  const changed = await restaurants.deactivate(id);
  if (!changed) {
    const restaurant = await restaurants.findById(id);
    if (!restaurant) throw new AppError(404, 'Restaurant not found.');
  }
}

function translateDatabaseError(error) {
  if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
    return new AppError(409, 'A restaurant with conflicting unique data already exists.');
  }
  return error;
}

module.exports = { listPublic, listMine, create, getById, update, setStatus, setOperatingStatus, deactivate };