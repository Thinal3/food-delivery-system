const express = require('express');
const controller = require('../controllers/delivery.controller');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const serviceAuth = require('../middleware/service-auth');
const validateRequest = require('../middleware/validate-request');
const schemas = require('../middleware/request-schemas');

const router = express.Router();

// Internal callbacks are secret-protected and only read Delivery's local DB.
router.get('/internal/orders/:orderId/status', serviceAuth,
  validateRequest({ params: schemas.orderId }), controller.internalStatus);

router.post('/', authenticate, authorizeRoles('ADMIN', 'RESTAURANT_ADMIN'),
  validateRequest({ body: schemas.create }), controller.create);
router.get('/mine', authenticate, validateRequest({ query: schemas.list }), controller.mine);
router.get('/me/orders/:orderId/assignment', authenticate, authorizeRoles('DELIVERY_PERSON'),
  validateRequest({ params: schemas.orderId }), controller.verifyAssignment);
router.get('/order/:orderId', authenticate,
  validateRequest({ params: schemas.orderId }), controller.forOrder);
router.get('/restaurant/:restaurantId', authenticate,
  validateRequest({ params: schemas.restaurantList, query: schemas.list }), controller.forRestaurant);
router.get('/', authenticate, authorizeRoles('ADMIN'),
  validateRequest({ query: schemas.list }), controller.all);
router.get('/:deliveryId', authenticate,
  validateRequest({ params: schemas.deliveryId }), controller.get);
router.patch('/:deliveryId/assign', authenticate, authorizeRoles('ADMIN'),
  validateRequest({ params: schemas.deliveryId, body: schemas.assign }), controller.assign);
router.patch('/:deliveryId/status', authenticate,
  validateRequest({ params: schemas.deliveryId, body: schemas.status }), controller.updateStatus);
router.post('/:deliveryId/cancel', authenticate,
  validateRequest({ params: schemas.deliveryId }), controller.cancel);

module.exports = router;