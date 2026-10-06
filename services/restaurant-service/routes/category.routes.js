const express = require('express');
const controller = require('../controllers/category.controller');
const authenticate = require('../middleware/authenticate');
const optionalAuthenticate = require('../middleware/optional-authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const validateRequest = require('../middleware/validate-request');
const requireRestaurantManager = require('../middleware/require-restaurant-manager');
const loadVisibleRestaurant = require('../middleware/load-visible-restaurant');
const schemas = require('../middleware/request-schemas');

const router = express.Router();
const managers = authorizeRoles('ADMIN', 'RESTAURANT_ADMIN');

router.get('/:restaurantId/categories', optionalAuthenticate,
	validateRequest({ params: schemas.restaurantId }), loadVisibleRestaurant, controller.list);
router.post('/:restaurantId/categories', authenticate, managers,
	validateRequest({ params: schemas.restaurantId }), requireRestaurantManager(),
	validateRequest({ body: schemas.categoryBody }), controller.create);
router.patch('/:restaurantId/categories/:categoryId', authenticate, managers,
	validateRequest({ params: schemas.categoryIdParams }), requireRestaurantManager(),
	validateRequest({ body: schemas.categoryBody }), controller.update);
router.delete('/:restaurantId/categories/:categoryId', authenticate, managers,
	validateRequest({ params: schemas.categoryIdParams }), requireRestaurantManager(), controller.remove);

module.exports = router;