const { serviceRequestTimeoutMs } = require('../config/env');
const AppError = require('../utils/app-error');

async function getJson(url, authorization) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(serviceRequestTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new AppError(503, 'A required service timed out.');
    throw new AppError(503, 'A required service is unavailable.');
  }
  if (response.status === 401) throw new AppError(401, 'Authentication token is invalid or expired.');
  if (response.status === 403) throw new AppError(403, 'The upstream service denied this request.');
  if (response.status === 404) return null;
  if (response.status >= 500) throw new AppError(503, 'A required service is unavailable.');
  if (!response.ok) throw new AppError(502, 'A required service returned an unexpected response.');
  try { return await response.json(); }
  catch { throw new AppError(502, 'A required service returned an unexpected response.'); }
}

module.exports = { getJson };