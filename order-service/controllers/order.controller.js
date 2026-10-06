const service = require('../services/order.service');

async function create(req, res, next) {
  try {
    const order = await service.create(req.auth, req.authorization, req.validated.body);
    return res.status(201).json({ order });
  } catch (error) { return next(error); }
}

async function mine(req, res, next) {
  try { return res.status(200).json(await service.listMine(req.auth, req.validated.query)); }
  catch (error) { return next(error); }
}

async function restaurant(req, res, next) {
  try {
    return res.status(200).json(await service.listRestaurant(
      req.auth, req.authorization, req.validated.params.restaurantId, req.validated.query,
    ));
  } catch (error) { return next(error); }
}

async function all(req, res, next) {
  try { return res.status(200).json(await service.listAll(req.auth, req.validated.query)); }
  catch (error) { return next(error); }
}

async function get(req, res, next) {
  try {
    const order = await service.getVisible(req.auth, req.authorization, req.validated.params.orderId);
    return res.status(200).json({ order });
  } catch (error) { return next(error); }
}

async function updateStatus(req, res, next) {
  try {
    const order = await service.changeStatus(
      req.auth, req.authorization, req.validated.params.orderId, req.validated.body.status,
    );
    return res.status(200).json({ order });
  } catch (error) { return next(error); }
}

async function cancel(req, res, next) {
  try {
    const order = await service.cancel(req.auth, req.authorization, req.validated.params.orderId);
    return res.status(200).json({ order });
  } catch (error) { return next(error); }
}

module.exports = { create, mine, restaurant, all, get, updateStatus, cancel };