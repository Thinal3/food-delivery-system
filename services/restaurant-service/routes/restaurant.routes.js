const express = require('express');
const controller = require('../controllers/restaurant.controller');
const authenticate = require('../middleware/authenticate');
const optionalAuthenticate = require('../middleware/optional-authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const validateRequest = require('../middleware/validate-request');
const requireRestaurantManager = require('../middleware/require-restaurant-manager');
const loadVisibleRestaurant = require('../middleware/load-visible-restaurant');
const schemas = require('../middleware/request-schemas');
const categoryRoutes = require('./category.routes');
const menuRoutes = require('./menu.routes');

const router = express.Router();
const managerRoles = authorizeRoles('ADMIN', 'RESTAURANT_ADMIN');
const restaurantIdValidation = validateRequest({ params: schemas.restaurantId });
const categoryParamsValidation = validateRequest({ params: schemas.categoryIdParams });
const itemParamsValidation = validateRequest({ params: schemas.menuItemParams });

// Register /mine before /:restaurantId so it is not parsed as an ID.
router.get('/mine', authenticate, managerRoles,
  validateRequest({ query: schemas.listRestaurants }), controller.mine);
router.get('/', validateRequest({ query: schemas.listRestaurants }), controller.list);
router.post('/', authenticate, managerRoles,
  validateRequest({ body: schemas.createRestaurant }), controller.create);

router.get('/:restaurantId', optionalAuthenticate, restaurantIdValidation,
  loadVisibleRestaurant, controller.get);
router.patch('/:restaurantId', authenticate, managerRoles, restaurantIdValidation,
  requireRestaurantManager(), validateRequest({ body: schemas.updateRestaurant }), controller.update);
router.patch('/:restaurantId/status', authenticate, managerRoles, restaurantIdValidation,
  requireRestaurantManager(), validateRequest({ body: schemas.restaurantStatus }), controller.setStatus);
router.patch('/:restaurantId/operating-status', authenticate, managerRoles, restaurantIdValidation,
  requireRestaurantManager(), validateRequest({ body: schemas.operatingStatus }), controller.setOperatingStatus);
router.delete('/:restaurantId', authenticate, managerRoles, restaurantIdValidation,
  requireRestaurantManager(), controller.deactivate);

router.use(categoryRoutes);
router.use(menuRoutes);

module.exports = router;