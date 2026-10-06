const express = require('express');
const controller = require('../controllers/customer.controller');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const validateRequest = require('../middleware/validate-request');
const schemas = require('../middleware/request-schemas');
const addressRoutes = require('./address.routes');

const router = express.Router();
const customerOnly = authorizeRoles('CUSTOMER');
const adminOnly = authorizeRoles('ADMIN');

// Self-service routes must be registered before /:customerId.
router.post('/me', authenticate, customerOnly,
  validateRequest({ body: schemas.createCustomer }), controller.create);
router.get('/me', authenticate, customerOnly, controller.getMine);
router.patch('/me', authenticate, customerOnly,
  validateRequest({ body: schemas.updateCustomer }), controller.updateMine);
router.use(addressRoutes);

router.get('/', authenticate, adminOnly,
  validateRequest({ query: schemas.pagination }), controller.list);
router.get('/:customerId', authenticate, adminOnly,
  validateRequest({ params: schemas.customerId }), controller.getById);
router.patch('/:customerId/status', authenticate, adminOnly,
  validateRequest({ params: schemas.customerId, body: schemas.status }), controller.setStatus);

module.exports = router;