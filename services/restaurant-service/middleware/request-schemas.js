const { z } = require('zod');
const { RESTAURANT_STATUSES, OPERATING_STATUSES } = require('../models/restaurant.model');
const { CATEGORY_NAME_MAX_LENGTH } = require('../models/category.model');
const { MENU_NAME_MAX_LENGTH, isPositivePrice } = require('../models/menu.model');

const idString = z.string().regex(/^[1-9]\d*$/, 'must be a positive integer ID')
  .transform(Number).refine(Number.isSafeInteger, 'must be a safe integer ID');
const idBody = z.union([
  z.number().int().positive().refine(Number.isSafeInteger, 'must be a safe integer ID'),
  idString,
]);
const idParams = z.object({ restaurantId: idString }).strict();
const nestedParams = z.object({ restaurantId: idString, resourceId: idString }).strict();
const ownerId = idBody;
const shortText = (max) => z.string().trim().min(1).max(max);
const nullableDescription = z.string().trim().max(2000).nullable().optional();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must use HH:MM format').nullable().optional();
const imageUrl = z.string().url().max(2048).refine((value) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}, 'must be an HTTP or HTTPS URL').nullable().optional();
const pageQuery = z.string().regex(/^[1-9]\d*$/).optional().default('1').transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value <= 1000000,
    'must be a safe integer no greater than 1000000');
const limitQuery = z.string().regex(/^[1-9]\d*$/).optional().default('20').transform(Number)
  .refine((value) => value <= 100, 'must be at most 100');
const booleanQuery = z.enum(['true', 'false']).optional().transform((value) => (
  value === undefined ? undefined : value === 'true'
));
const price = z.string().refine(isPositivePrice,
  'must be greater than zero with at most 2 decimal places and fit DECIMAL(10,2)');
const availability = z.boolean();

function timePair(schema) {
  return schema.refine((value) => (
    (value.openingTime === undefined && value.closingTime === undefined)
    || (value.openingTime === null && value.closingTime === null)
    || (value.openingTime != null && value.closingTime != null)
  ), { message: 'openingTime and closingTime must be provided together', path: ['openingTime'] });
}

const schemas = {
  listRestaurants: z.object({
    page: pageQuery,
    limit: limitQuery,
    cuisine: z.string().trim().min(1).max(80).optional(),
    operatingStatus: z.enum(OPERATING_STATUSES).optional(),
  }).strict(),
  restaurantId: idParams,
  createRestaurant: timePair(z.object({
    name: shortText(120),
    description: nullableDescription,
    address: shortText(255),
    contactNumber: shortText(32),
    email: z.string().trim().email().max(254),
    cuisineType: shortText(80),
    openingTime: time,
    closingTime: time,
    ownerUserId: ownerId.optional(),
  }).strict()),
  updateRestaurant: timePair(z.object({
    name: shortText(120).optional(),
    description: nullableDescription,
    address: shortText(255).optional(),
    contactNumber: shortText(32).optional(),
    email: z.string().trim().email().max(254).optional(),
    cuisineType: shortText(80).optional(),
    openingTime: time,
    closingTime: time,
  }).strict()).refine((value) => Object.keys(value).length > 0, 'at least one editable field is required'),
  restaurantStatus: z.object({ status: z.enum(RESTAURANT_STATUSES) }).strict(),
  operatingStatus: z.object({ operatingStatus: z.enum(OPERATING_STATUSES) }).strict(),
  categoryParams: nestedParams,
  categoryIdParams: z.object({ restaurantId: idString, categoryId: idString }).strict(),
  listCategories: z.object({}).strict(),
  categoryBody: z.object({ name: shortText(CATEGORY_NAME_MAX_LENGTH) }).strict(),
  menuList: z.object({
    page: pageQuery,
    limit: limitQuery,
    categoryId: idString.optional(),
    availability: booleanQuery,
  }).strict(),
  menuItemParams: z.object({ restaurantId: idString, itemId: idString }).strict(),
  createMenuItem: z.object({
    categoryId: idBody,
    name: shortText(MENU_NAME_MAX_LENGTH),
    description: nullableDescription,
    price,
    availability: availability.optional().default(true),
    imageUrl,
  }).strict(),
  updateMenuItem: z.object({
    categoryId: idBody.optional(),
    name: shortText(MENU_NAME_MAX_LENGTH).optional(),
    description: nullableDescription,
    price: price.optional(),
    imageUrl,
  }).strict().refine((value) => Object.keys(value).length > 0, 'at least one editable field is required'),
  itemAvailability: z.object({ availability }).strict(),
};

module.exports = schemas;