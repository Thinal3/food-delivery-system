const categories = require('../repositories/category.repository');
const AppError = require('../utils/app-error');

async function list(restaurantId) {
  return categories.list(restaurantId);
}

async function create(restaurantId, name) {
  try {
    return await categories.create(restaurantId, name);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new AppError(409, 'A category with this name already exists for this restaurant.');
    }
    throw error;
  }
}

async function update(restaurantId, categoryId, name) {
  try {
    const category = await categories.update(restaurantId, categoryId, name);
    if (!category) throw new AppError(404, 'Category not found for this restaurant.');
    return category;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new AppError(409, 'A category with this name already exists for this restaurant.');
    }
    throw error;
  }
}

async function remove(restaurantId, categoryId) {
  const outcome = await categories.remove(restaurantId, categoryId);
  if (outcome === 'NOT_FOUND') throw new AppError(404, 'Category not found for this restaurant.');
  if (outcome === 'HAS_ITEMS') {
    throw new AppError(409, 'Category still contains menu items that have not been deleted.');
  }
}

module.exports = { list, create, update, remove };