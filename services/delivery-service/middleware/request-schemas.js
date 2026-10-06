const { z } = require('zod');
const { DELIVERY_STATUSES } = require('../models/delivery.model');

const idParam = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .refine(Number.isSafeInteger, 'must be a safe positive integer');
const pagination = {
  page: z.string().regex(/^[1-9]\d*$/).optional().default('1').transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value <= 1000000, 'must be between 1 and 1000000'),
  limit: z.string().regex(/^[1-9]\d*$/).optional().default('20').transform(Number)
    .refine((value) => value <= 100, 'must be at most 100'),
  status: z.enum(DELIVERY_STATUSES).optional(),
};

module.exports = {
  create: z.object({ orderId: z.number().int().positive().refine(Number.isSafeInteger) }).strict(),
  deliveryId: z.object({ deliveryId: idParam }).strict(),
  orderId: z.object({ orderId: idParam }).strict(),
  assign: z.object({ deliveryPersonId: z.number().int().positive().refine(Number.isSafeInteger) }).strict(),
  status: z.object({
    status: z.enum(DELIVERY_STATUSES),
    failureReason: z.string().trim().min(1).max(500).optional(),
  }).strict(),
  list: z.object(pagination).strict(),
  restaurantList: z.object({ restaurantId: idParam }).strict(),
};