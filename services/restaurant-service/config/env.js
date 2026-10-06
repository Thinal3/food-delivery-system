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
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const authServiceUrl = required('AUTH_SERVICE_URL', 'http://localhost:5001');
try {
  const parsed = new URL(authServiceUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
} catch {
  throw new Error('AUTH_SERVICE_URL must be a valid HTTP or HTTPS URL.');
}

module.exports = Object.freeze({
  port: positiveInteger('PORT', 5002),
  authServiceUrl: authServiceUrl.replace(/\/$/, ''),
  authRequestTimeoutMs: positiveInteger('AUTH_REQUEST_TIMEOUT_MS', 5000),
  database: {
    host: required('DB_HOST', '127.0.0.1'),
    port: positiveInteger('DB_PORT', 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME', 'food_delivery_restaurant'),
    waitForConnections: true,
    connectionLimit: positiveInteger('DB_CONNECTION_LIMIT', 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    decimalNumbers: false,
  },
});