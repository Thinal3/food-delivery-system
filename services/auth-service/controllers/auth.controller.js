const authService = require('../services/auth.service');

async function register(req, res, next) {
  try {
    const result = await authService.register(req.validated.body);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.validated.body);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function currentUser(req, res, next) {
  try {
    return res.status(200).json({ user: req.auth });
  } catch (error) {
    return next(error);
  }
}

async function verify(req, res) {
  return res.status(200).json({ user: req.auth });
}

async function createUser(req, res, next) {
  try {
    const user = await authService.createAdminManagedAccount(req.validated.body);
    return res.status(201).json({ user });
  } catch (error) {
    return next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    const result = await authService.listUsers(
      req.validated.query.page,
      req.validated.query.limit,
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function updateRole(req, res, next) {
  try {
    const user = await authService.updateUserRole(
      req.validated.params.userId,
      req.validated.body.role,
    );
    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const user = await authService.updateUserStatus(
      req.validated.params.userId,
      req.validated.body.status,
    );
    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  register,
  login,
  currentUser,
  verify,
  createUser,
  listUsers,
  updateRole,
  updateStatus,
};