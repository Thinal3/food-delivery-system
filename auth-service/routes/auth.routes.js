const express = require('express');
const { rateLimit } = require('express-rate-limit');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorize-roles');
const validateRequest = require('../middleware/validate-request');
const schemas = require('../middleware/request-schemas');

const router = express.Router();
const loginLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	message: { error: 'Too many login attempts. Try again later.' },
});
const registrationLimiter = rateLimit({
	windowMs: 60 * 60 * 1000,
	limit: 20,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	message: { error: 'Too many registration attempts. Try again later.' },
});

router.post('/register', registrationLimiter, validateRequest({ body: schemas.register }), authController.register);
router.post('/login', loginLimiter, validateRequest({ body: schemas.login }), authController.login);
router.get('/me', authenticate, authController.currentUser);
router.get('/verify', authenticate, authController.verify);

router.post(
	'/users',
	authenticate,
	authorizeRoles('ADMIN'),
	validateRequest({ body: schemas.createUser }),
	authController.createUser,
);
router.get(
	'/users',
	authenticate,
	authorizeRoles('ADMIN'),
	validateRequest({ query: schemas.listUsers }),
	authController.listUsers,
);
router.patch(
	'/users/:userId/role',
	authenticate,
	authorizeRoles('ADMIN'),
	validateRequest({ params: schemas.userId, body: schemas.updateRole }),
	authController.updateRole,
);
router.patch(
	'/users/:userId/status',
	authenticate,
	authorizeRoles('ADMIN'),
	validateRequest({ params: schemas.userId, body: schemas.updateStatus }),
	authController.updateStatus,
);

module.exports = router;