const { z } = require('zod');
const { USER_ROLES, USER_STATUSES } = require('../models/user.model');

const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(8).max(72)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'must be at most 72 UTF-8 bytes');
const name = z.string().trim().min(2).max(100);
const userId = z.object({
  userId: z.string().regex(/^[1-9]\d*$/).transform(Number)
    .refine(Number.isSafeInteger, 'must be a safe positive integer'),
}).strict();

const schemas = {
  register: z.object({ name, email, password }).strict(),
  login: z.object({ email, password }).strict(),
  createUser: z.object({
    name,
    email,
    password,
    role: z.enum(USER_ROLES),
    status: z.enum(USER_STATUSES).optional().default('ACTIVE'),
  }).strict(),
  listUsers: z.object({
    page: z.string().regex(/^[1-9]\d*$/).optional().default('1').transform(Number)
      .refine(Number.isSafeInteger, 'must be a safe positive integer'),
    limit: z.string().regex(/^[1-9]\d*$/).optional().default('20').transform(Number)
      .refine((value) => value <= 100, 'must be at most 100'),
  }).strict(),
  userId,
  updateRole: z.object({ role: z.enum(USER_ROLES) }).strict(),
  updateStatus: z.object({ status: z.enum(USER_STATUSES) }).strict(),
};

module.exports = schemas;