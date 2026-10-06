const restaurants = require('../repositories/restaurant.repository');
const AppError = require('../utils/app-error');

async function loadVisibleRestaurant(req, res, next) {
  try {
    const restaurantId = req.validated.params.restaurantId;
    const restaurant = await restaurants.findById(restaurantId);
    if (!restaurant) throw new AppError(404, 'Restaurant not found.');
    if (restaurant.status !== 'ACTIVE') {
      const canInspect = req.auth && (req.auth.role === 'ADMIN'
        || (req.auth.role === 'RESTAURANT_ADMIN'
          && Number(restaurant.owner_user_id) === req.auth.userId));
      if (!canInspect) throw new AppError(404, 'Restaurant not found.');
    }
    req.restaurant = restaurant;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = loadVisibleRestaurant;