const restaurants = require('../repositories/restaurant.repository');
const AppError = require('../utils/app-error');

function requireRestaurantManager(idParam = 'restaurantId') {
  return async (req, res, next) => {
    try {
      const restaurant = await restaurants.findById(req.validated.params[idParam]);
      if (!restaurant) throw new AppError(404, 'Restaurant not found.');
      if (req.auth.role !== 'ADMIN'
        && !(req.auth.role === 'RESTAURANT_ADMIN'
          && Number(restaurant.owner_user_id) === req.auth.userId)) {
        throw new AppError(403, 'You do not have permission to manage this restaurant.');
      }
      req.restaurant = restaurant;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = requireRestaurantManager;