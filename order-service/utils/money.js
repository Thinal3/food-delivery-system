const MAX_CENTS = 9999999999n;

function decimalToCents(value, { allowZero = false } = {}) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > MAX_CENTS || (!allowZero && cents <= 0n)) return null;
  return cents;
}

function centsToDecimal(value) {
  const cents = BigInt(value);
  if (cents < 0n || cents > MAX_CENTS) throw new RangeError('Money value exceeds DECIMAL(10,2).');
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

function multiplyPrice(price, quantity) {
  const unitCents = decimalToCents(price);
  if (unitCents === null) throw new RangeError('Upstream price is invalid.');
  const total = unitCents * BigInt(quantity);
  if (total > MAX_CENTS) throw new RangeError('Order total exceeds DECIMAL(10,2).');
  return total;
}

module.exports = { MAX_CENTS, decimalToCents, centsToDecimal, multiplyPrice };