const { customerServiceUrl } = require('../config/env');
const { getJson } = require('./http-client');
const AppError = require('../utils/app-error');

async function getCustomerForUser(userId, authorization) {
  const payload = await getJson(`${customerServiceUrl}/api/customers/me`, authorization);
  if (!payload) throw new AppError(503, 'Customer profile API is not available yet.');
  const customer = payload?.customer;
  if (!customer || !Number.isSafeInteger(Number(customer.id)) || Number(customer.id) < 1
    || Number(customer.user_id) !== userId || customer.status === 'INACTIVE') {
    throw new AppError(502, 'Customer service returned an unexpected profile response.');
  }
  return { id: Number(customer.id), userId: Number(customer.user_id) };
}

async function getOwnedAddress(addressId, customerId, authorization) {
  const payload = await getJson(
    `${customerServiceUrl}/api/customers/me/addresses/${addressId}`,
    authorization,
  );
  const address = payload?.address;
  if (!address || Number(address.id) !== addressId || Number(address.customer_id) !== customerId) {
    throw new AppError(404, 'Delivery address not found for this customer.');
  }
  const line1 = address.line1 ?? address.address_line1;
  const city = address.city;
  if (typeof line1 !== 'string' || typeof city !== 'string') {
    throw new AppError(502, 'Customer service returned an unexpected address response.');
  }
  return {
    id: addressId,
    line1,
    line2: address.line2 ?? address.address_line2 ?? null,
    city,
    region: address.region ?? address.state ?? null,
    postalCode: address.postal_code ?? address.postalCode ?? null,
    country: address.country ?? null,
  };
}

module.exports = { getCustomerForUser, getOwnedAddress };