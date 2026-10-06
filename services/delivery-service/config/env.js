const dotenv = require('dotenv');
dotenv.config();

function required(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!value || /replace-with/i.test(value)) {
    throw new Error(`${name} must be set to a real value.`);
  }
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function serviceUrl(name, fallback) {
  const value = required(name, fallback).replace(/\/$/, '');
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch { throw new Error(`${name} must be a valid HTTP or HTTPS URL.`); }
  return value;
}

const syncSecret = required('ORDER_DELIVERY_SYNC_SECRET');
if (syncSecret.length < 32) throw new Error('ORDER_DELIVERY_SYNC_SECRET must be at least 32 characters.');

module.exports = Object.freeze({
  port: positiveInteger('PORT', 5004),
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL', 'http://localhost:5001'),
  orderServiceUrl: serviceUrl('ORDER_SERVICE_URL', 'http://localhost:5003'),
  restaurantServiceUrl: serviceUrl('RESTAURANT_SERVICE_URL', 'http://localhost:5002'),
  serviceRequestTimeoutMs: positiveInteger('SERVICE_REQUEST_TIMEOUT_MS', 5000),
  orderDeliverySyncSecret: syncSecret,
  syncPollIntervalMs: positiveInteger('SYNC_POLL_INTERVAL_MS', 1000),
  syncMaxAttempts: positiveInteger('SYNC_MAX_ATTEMPTS', 8),
  database: {
    host: required('DB_HOST', '127.0.0.1'),
    port: positiveInteger('DB_PORT', 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME', 'food_delivery_delivery'),
    waitForConnections: true,
    connectionLimit: positiveInteger('DB_CONNECTION_LIMIT', 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    decimalNumbers: false,
  },
});