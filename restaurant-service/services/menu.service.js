const menu = require('../repositories/menu.repository');
const AppError = require('../utils/app-error');

async function list(restaurantId, query) {
  return menu.list(restaurantId, query);
}

async function get(restaurantId, itemId) {
  const item = await menu.findById(restaurantId, itemId);
  if (!item) throw new AppError(404, 'Menu item not found for this restaurant.');
  return item;
}

async function assertCategory(restaurantId, categoryId) {
  if (!(await menu.categoryBelongsToRestaurant(restaurantId, categoryId))) {
    throw new AppError(400, 'categoryId must identify a category in this restaurant.');
  }
}

async function create(restaurantId, input) {
  await assertCategory(restaurantId, input.categoryId);
  try {
    return await menu.create(restaurantId, input);
  } catch (error) {
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.errno === 1452) {
      throw new AppError(400, 'categoryId must identify an existing category.');
    }
    throw error;
  }
}

async function update(restaurantId, itemId, input) {
  if (input.categoryId !== undefined) await assertCategory(restaurantId, input.categoryId);
  try {
    const item = await menu.update(restaurantId, itemId, input);
    if (!item) throw new AppError(404, 'Menu item not found for this restaurant.');
    return item;
  } catch (error) {
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.errno === 1452) {
      throw new AppError(400, 'categoryId must identify an existing category.');
    }
    throw error;
  }
}

async function setAvailability(restaurantId, itemId, availability) {
  const item = await menu.setAvailability(restaurantId, itemId, availability);
  if (!item) throw new AppError(404, 'Menu item not found for this restaurant.');
  return item;
}

async function softDelete(restaurantId, itemId) {
  if (!(await menu.softDelete(restaurantId, itemId))) {
    throw new AppError(404, 'Menu item not found for this restaurant.');
  }
}

module.exports = { list, get, create, update, setAvailability, softDelete };