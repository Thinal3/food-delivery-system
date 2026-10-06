const addresses = require('../repositories/address.repository');
const customerService = require('./customer.service');
const AppError = require('../utils/app-error');

function publicAddress(address) {
  if (!address) return null;
  return {
    id: Number(address.id),
    customer_id: Number(address.customer_id),
    address_name: address.address_name,
    address_line1: address.address_line1,
    address_line2: address.address_line2,
    city: address.city,
    postal_code: address.postal_code,
    latitude: address.latitude,
    longitude: address.longitude,
    is_default: Boolean(address.is_default),
    created_at: address.created_at,
    updated_at: address.updated_at,
    // Order consumes these aliases when it snapshots the selected address.
    line1: address.address_line1,
    line2: address.address_line2,
    postalCode: address.postal_code,
  };
}

async function listMine(identity) {
  const customer = await customerService.activeOwnProfile(identity);
  const result = await addresses.list(customer.id);
  return { addresses: result.map(publicAddress) };
}

async function getMine(identity, addressId) {
  const customer = await customerService.activeOwnProfile(identity);
  const address = await addresses.findById(customer.id, addressId);
  if (!address) throw new AppError(404, 'Address not found.');
  return publicAddress(address);
}

async function create(identity, input) {
  const customer = await customerService.activeOwnProfile(identity);
  const result = await addresses.create(customer.id, input);
  if (result?.customerInactive) throw new AppError(403, 'Customer profile is inactive.');
  return publicAddress(result);
}

async function update(identity, addressId, input) {
  const customer = await customerService.activeOwnProfile(identity);
  const address = await addresses.update(customer.id, addressId, input);
  if (address?.customerInactive) throw new AppError(403, 'Customer profile is inactive.');
  if (!address) throw new AppError(404, 'Address not found.');
  return publicAddress(address);
}

async function setDefault(identity, addressId) {
  const customer = await customerService.activeOwnProfile(identity);
  const address = await addresses.setDefault(customer.id, addressId);
  if (address?.customerInactive) throw new AppError(403, 'Customer profile is inactive.');
  if (!address) throw new AppError(404, 'Address not found.');
  return publicAddress(address);
}

async function remove(identity, addressId) {
  const customer = await customerService.activeOwnProfile(identity);
  const result = await addresses.remove(customer.id, addressId);
  if (result?.customerInactive) throw new AppError(403, 'Customer profile is inactive.');
  if (!result) throw new AppError(404, 'Address not found.');
}

module.exports = { publicAddress, listMine, getMine, create, update, setDefault, remove };