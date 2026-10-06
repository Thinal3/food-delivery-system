const { z } = require('zod');
const { ORDER_STATUSES } = require('../models/order.model');
const { MAX_QUANTITY, MAX_ITEMS_PER_ORDER } = require('../models/order-item.model');

const positiveId = z.number().int().positive().refine(Number.isSafeInteger, 'must be a safe positive integer');
const idParam = z.object({ orderId: z.string().regex(/^[1-9]\d*$/).transform(Number)
  .refine(Number.isSafeInteger, 'must be a safe positive integer') }).strict();
const page = z.string().regex(/^[1-9]\d*$/).optional().default('1').transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value <= 1000000, 'must be between 1 and 1000000');
const limit = z.string().regex(/^[1-9]\d*$/).optional().default('20').transform(Number)
  .refine((value) => value <= 100, 'must be at most 100');

module.exports = {
  createOrder: z.object({
    restaurantId: positiveId,
    deliveryAddressId: positiveId,
    items: z.array(z.object({
      menuItemId: positiveId,
      quantity: z.number().int().min(1).max(MAX_QUANTITY),
    }).strict()).min(1).max(MAX_ITEMS_PER_ORDER),
  }).strict(),
  list: z.object({ page, limit, status: z.enum(ORDER_STATUSES).optional() }).strict(),
  restaurantId: z.object({ restaurantId: z.string().regex(/^[1-9]\d*$/).transform(Number)
    .refine(Number.isSafeInteger, 'must be a safe positive integer') }).strict(),
  orderId: idParam,
  updateStatus: z.object({ status: z.enum(ORDER_STATUSES) }).strict(),
  deliverySync: z.object({
    orderId: positiveId,
    deliveryId: positiveId,
    status: z.enum(['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']),
  }).strict(),
};