const { z } = require('zod');
const { USER_ROLES, USER_STATUSES } = require('../models/user.model');
const authService = require('../services/auth.service');
const { closePool } = require('../config/database');

async function main() {
  const credentials = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(72)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
  }).safeParse({
    name: process.env.ADMIN_NAME,
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });

  if (!credentials.success) {
    throw new Error('Set valid ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD values in the environment.');
  }

  // This command is explicit and one-shot: existing accounts cause an error, never a reset.
  const user = await authService.createAdminManagedAccount({
    ...credentials.data,
    role: z.enum(USER_ROLES).parse('ADMIN'),
    status: z.enum(USER_STATUSES).parse('ACTIVE'),
  });
  console.log(`Created initial ADMIN account ${user.email} (id ${user.id}).`);
}

main()
  .catch((error) => {
    console.error(error.message === 'An account with this email already exists.'
      ? 'Bootstrap stopped: an account with ADMIN_EMAIL already exists; no account was changed.'
      : error.message.startsWith('Set valid')
        ? error.message
        : 'Admin bootstrap failed. Check database connectivity and setup; no credentials were logged.');
    process.exitCode = 1;
  })
  .finally(closePool);