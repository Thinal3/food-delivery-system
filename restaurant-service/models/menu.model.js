const MENU_NAME_MAX_LENGTH = 120;
const PRICE_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;

function isPositivePrice(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const raw = String(value);
  if (!PRICE_PATTERN.test(raw)) return false;
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) > 0n;
}

module.exports = { MENU_NAME_MAX_LENGTH, PRICE_PATTERN, isPositivePrice };