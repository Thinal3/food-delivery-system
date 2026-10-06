const express = require('express');
const controller = require('../controllers/menu.controller');
const authenticate = require('../middleware/authenticate');
const optionalAuthenticate = require('../middleware/optional-authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const validateRequest = require('../middleware/validate-request');
const requireRestaurantManager = require('../middleware/require-restaurant-manager');
const loadVisibleRestaurant = require('../middleware/load-visible-restaurant');
const schemas = require('../middleware/request-schemas');

const router = express.Router();
const managers = authorizeRoles('ADMIN', 'RESTAURANT_ADMIN');

router.get('/:restaurantId/menu', optionalAuthenticate,
	validateRequest({ params: schemas.restaurantId }), loadVisibleRestaurant,
	validateRequest({ query: schemas.menuList }), controller.list);
router.get('/:restaurantId/menu/:itemId', optionalAuthenticate,
	validateRequest({ params: schemas.menuItemParams }), loadVisibleRestaurant, controller.get);
router.post('/:restaurantId/menu', authenticate, managers,
	validateRequest({ params: schemas.restaurantId }), requireRestaurantManager(),
	validateRequest({ body: schemas.createMenuItem }), controller.create);
router.patch('/:restaurantId/menu/:itemId', authenticate, managers,
	validateRequest({ params: schemas.menuItemParams }), requireRestaurantManager(),
	validateRequest({ body: schemas.updateMenuItem }), controller.update);
router.patch('/:restaurantId/menu/:itemId/availability', authenticate, managers,
	validateRequest({ params: schemas.menuItemParams }), requireRestaurantManager(),
	validateRequest({ body: schemas.itemAvailability }), controller.setAvailability);
router.delete('/:restaurantId/menu/:itemId', authenticate, managers,
	validateRequest({ params: schemas.menuItemParams }), requireRestaurantManager(), controller.softDelete);

module.exports = router;