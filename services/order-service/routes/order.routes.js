const express = require('express');
const controller = require('../controllers/order.controller');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const validateRequest = require('../middleware/validate-request');
const schemas = require('../middleware/request-schemas');
const deliverySyncAuth = require('../middleware/delivery-sync-auth');

const router = express.Router();

router.post('/', authenticate, authorizeRoles('CUSTOMER'),
  validateRequest({ body: schemas.createOrder }), controller.create);

router.post('/internal/delivery-sync', deliverySyncAuth,
  validateRequest({ body: schemas.deliverySync }), controller.deliverySync);

// Keep fixed collection routes ahead of /:orderId.
router.get('/mine', authenticate, validateRequest({ query: schemas.list }), controller.mine);
router.get('/restaurant/:restaurantId', authenticate,
  validateRequest({ params: schemas.restaurantId, query: schemas.list }), controller.restaurant);
router.get('/', authenticate, authorizeRoles('ADMIN'),
  validateRequest({ query: schemas.list }), controller.all);

router.get('/:orderId', authenticate,
  validateRequest({ params: schemas.orderId }), controller.get);
router.patch('/:orderId/status', authenticate,
  validateRequest({ params: schemas.orderId, body: schemas.updateStatus }), controller.updateStatus);
router.post('/:orderId/cancel', authenticate,
  validateRequest({ params: schemas.orderId }), controller.cancel);

module.exports = router;