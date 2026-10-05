const dotenv = require('dotenv');

dotenv.config();

// Validate configuration when this module loads so a bad setup fails before serving requests.
function requiredString(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set in the environment.`);
  return value;
}

function positiveInteger(name, defaultValue) {
  const value = Number(process.env[name] || defaultValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const jwtSecret = requiredString('JWT_SECRET');
// Reject the template value as well as short secrets to avoid starting with an unsafe signing key.
if (jwtSecret.length < 32 || /replace-this/i.test(jwtSecret)) {
  throw new Error('JWT_SECRET must be a real secret containing at least 32 characters.');
}

const port = positiveInteger('PORT', 5001);
if (port > 65535) throw new Error('PORT must be between 1 and 65535.');

const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '15m';
if (!/^\d+[smh]$/.test(jwtExpiresIn)) {
  throw new Error('JWT_EXPIRES_IN must be an integer followed by s, m, or h.');
}
const expiryValue = Number.parseInt(jwtExpiresIn, 10);
const expirySeconds = jwtExpiresIn.endsWith('h')
  ? expiryValue * 3600
  : jwtExpiresIn.endsWith('m')
    ? expiryValue * 60
    : expiryValue;
if (expirySeconds < 1 || expirySeconds > 3600) {
  throw new Error('JWT_EXPIRES_IN must be between 1 second and 1 hour.');
}

module.exports = {
  port,
  jwtSecret,
  jwtExpiresIn,
  jwtIssuer: requiredString('JWT_ISSUER'),
  jwtAudience: requiredString('JWT_AUDIENCE'),
  database: {
    host: requiredString('DB_HOST'),
    port: positiveInteger('DB_PORT', 3306),
    user: requiredString('DB_USER'),
    password: requiredString('DB_PASSWORD'),
    database: requiredString('DB_NAME'),
    waitForConnections: true,
    connectionLimit: positiveInteger('DB_CONNECTION_LIMIT', 10),
    queueLimit: 0,
    charset: 'utf8mb4',
  },
};