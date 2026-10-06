const customers = require('../repositories/customer.repository');
const AppError = require('../utils/app-error');

function publicCustomer(customer) {
  if (!customer) return null;
  return {
    id: Number(customer.id),
    user_id: Number(customer.user_id),
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone_number: customer.phone_number,
    profile_image: customer.profile_image,
    status: customer.status,
    created_at: customer.created_at,
    updated_at: customer.updated_at,
  };
}

async function activeOwnProfile(identity) {
  if (identity.role !== 'CUSTOMER') throw new AppError(403, 'Only CUSTOMER accounts can access a customer profile.');
  const customer = await customers.findByUserId(identity.userId);
  if (!customer) throw new AppError(404, 'Customer profile not found. Create your profile first.');
  if (customer.status !== 'ACTIVE') throw new AppError(403, 'Customer profile is inactive.');
  return publicCustomer(customer);
}

async function create(identity, input) {
  if (identity.role !== 'CUSTOMER') throw new AppError(403, 'Only CUSTOMER accounts can create a customer profile.');
  try {
    return publicCustomer(await customers.create(identity.userId, input));
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new AppError(409, 'A customer profile already exists for this Auth user.');
    }
    throw error;
  }
}

async function getMine(identity) {
  return activeOwnProfile(identity);
}

async function updateMine(identity, input) {
  await activeOwnProfile(identity);
  const customer = await customers.updateByUserId(identity.userId, input);
  if (!customer) throw new AppError(403, 'Customer profile is inactive.');
  return publicCustomer(customer);
}

async function listAll(query) {
  const result = await customers.list(query.page, query.limit);
  return { ...result, customers: result.customers.map(publicCustomer) };
}

async function getById(customerId) {
  const customer = await customers.findById(customerId);
  if (!customer) throw new AppError(404, 'Customer profile not found.');
  return publicCustomer(customer);
}

async function setStatus(customerId, status) {
  const customer = await customers.setStatus(customerId, status);
  if (!customer) throw new AppError(404, 'Customer profile not found.');
  return publicCustomer(customer);
}

module.exports = { publicCustomer, activeOwnProfile, create, getMine, updateMine, listAll, getById, setStatus };