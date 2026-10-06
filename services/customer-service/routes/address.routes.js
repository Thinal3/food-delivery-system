const express = require('express');
const controller = require('../controllers/address.controller');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const validateRequest = require('../middleware/validate-request');
const schemas = require('../middleware/request-schemas');

const router = express.Router();
const customerOnly = authorizeRoles('CUSTOMER');

router.post('/me/addresses', authenticate, customerOnly,
  validateRequest({ body: schemas.createAddress }), controller.create);
router.get('/me/addresses', authenticate, customerOnly, controller.list);
router.get('/me/addresses/:addressId', authenticate, customerOnly,
  validateRequest({ params: schemas.addressId }), controller.get);
router.patch('/me/addresses/:addressId/default', authenticate, customerOnly,
  validateRequest({ params: schemas.addressId, body: schemas.defaultAddress }), controller.setDefault);
router.patch('/me/addresses/:addressId', authenticate, customerOnly,
  validateRequest({ params: schemas.addressId, body: schemas.updateAddress }), controller.update);
router.delete('/me/addresses/:addressId', authenticate, customerOnly,
  validateRequest({ params: schemas.addressId }), controller.remove);

module.exports = router;