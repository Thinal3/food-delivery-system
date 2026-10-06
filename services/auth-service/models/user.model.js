const USER_ROLES = Object.freeze([
  'ADMIN',
  'CUSTOMER',
  'RESTAURANT_ADMIN',
  'DELIVERY_PERSON',
]);

const USER_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);

module.exports = { USER_ROLES, USER_STATUSES };