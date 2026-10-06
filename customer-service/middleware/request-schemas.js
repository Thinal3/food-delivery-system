const { z } = require('zod');
const { CUSTOMER_STATUSES, PROFILE_IMAGE_MAX_LENGTH } = require('../models/customer.model');
const { ADDRESS_NAME_MAX_LENGTH } = require('../models/address.model');

const idParam = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value <= 4294967295,
    'must be a valid INT UNSIGNED ID');
const page = z.string().regex(/^[1-9]\d*$/).optional().default('1').transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value <= 1000000, 'must be between 1 and 1000000');
const limit = z.string().regex(/^[1-9]\d*$/).optional().default('20').transform(Number)
  .refine((value) => value <= 100, 'must be at most 100');
const optionalImage = z.string().url().max(PROFILE_IMAGE_MAX_LENGTH).nullable().optional()
  .refine((value) => {
    if (value == null) return true;
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }, 'must be an HTTP or HTTPS URL');
const coordinate = (min, max) => z.union([z.number(), z.string()]).nullable().optional()
  .refine((value) => {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return false;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max;
  }, `must be between ${min} and ${max}`)
  .transform((value) => value == null ? value : Number(value));

function coordinatePair(schema) {
  return schema.refine((value) => {
    const hasLat = Object.hasOwn(value, 'latitude');
    const hasLng = Object.hasOwn(value, 'longitude');
    return hasLat === hasLng;
  }, { message: 'latitude and longitude must be supplied or cleared together', path: ['latitude'] });
}

const schemas = {
  customerId: z.object({ customerId: idParam }).strict(),
  addressId: z.object({ addressId: idParam }).strict(),
  pagination: z.object({ page, limit }).strict(),
  createCustomer: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phoneNumber: z.string().trim().min(5).max(32),
    profileImage: optionalImage,
  }).strict(),
  updateCustomer: z.object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    phoneNumber: z.string().trim().min(5).max(32).optional(),
    profileImage: optionalImage,
  }).strict().refine((value) => Object.keys(value).length > 0, 'at least one editable field is required'),
  status: z.object({ status: z.enum(CUSTOMER_STATUSES) }).strict(),
  createAddress: coordinatePair(z.object({
    addressName: z.string().trim().min(1).max(ADDRESS_NAME_MAX_LENGTH),
    addressLine1: z.string().trim().min(1).max(160),
    addressLine2: z.string().trim().max(160).nullable().optional(),
    city: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().min(1).max(20),
    latitude: coordinate(-90, 90),
    longitude: coordinate(-180, 180),
    isDefault: z.boolean().optional().default(false),
  }).strict()),
  updateAddress: coordinatePair(z.object({
    addressName: z.string().trim().min(1).max(ADDRESS_NAME_MAX_LENGTH).optional(),
    addressLine1: z.string().trim().min(1).max(160).optional(),
    addressLine2: z.string().trim().max(160).nullable().optional(),
    city: z.string().trim().min(1).max(100).optional(),
    postalCode: z.string().trim().min(1).max(20).optional(),
    latitude: coordinate(-90, 90),
    longitude: coordinate(-180, 180),
  }).strict()).refine((value) => Object.keys(value).length > 0, 'at least one editable field is required'),
  defaultAddress: z.object({}).strict(),
};

module.exports = schemas;