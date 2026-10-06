const dotenv = require('dotenv');
dotenv.config();

function required(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!value || /replace-with-your-own-password/i.test(value)) {
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
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`);
  }
  return value;
}

module.exports = Object.freeze({
  port: positiveInteger('PORT', 5005),
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL', 'http://localhost:5001'),
  serviceRequestTimeoutMs: positiveInteger('SERVICE_REQUEST_TIMEOUT_MS', 5000),
  database: {
    host: required('DB_HOST', '127.0.0.1'),
    port: positiveInteger('DB_PORT', 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME', 'food_delivery_customer'),
    waitForConnections: true,
    connectionLimit: positiveInteger('DB_CONNECTION_LIMIT', 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    decimalNumbers: false,
  },
});