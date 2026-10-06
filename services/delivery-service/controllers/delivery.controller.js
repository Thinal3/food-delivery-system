const service = require('../services/delivery.service');
const repository = require('../repositories/delivery.repository');
const AppError = require('../utils/app-error');

async function create(req, res, next) {
  try {
    const delivery = await service.create(req.auth, req.authorization, req.validated.body.orderId);
    return res.status(201).json({ delivery });
  } catch (error) { return next(error); }
}

async function mine(req, res, next) {
  try { return res.status(200).json(await service.listMine(req.auth, req.validated.query)); }
  catch (error) { return next(error); }
}

async function forOrder(req, res, next) {
  try {
    const delivery = await service.listForOrder(req.auth, req.authorization, req.validated.params.orderId);
    return res.status(200).json({ delivery });
  } catch (error) { return next(error); }
}

async function forRestaurant(req, res, next) {
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
    const delivery = await service.get(req.auth, req.authorization, req.validated.params.deliveryId);
    return res.status(200).json({ delivery });
  } catch (error) { return next(error); }
}

async function assign(req, res, next) {
  try {
    const delivery = await service.assign(req.auth, req.authorization,
      req.validated.params.deliveryId, req.validated.body.deliveryPersonId);
    return res.status(200).json({ delivery });
  } catch (error) { return next(error); }
}

async function updateStatus(req, res, next) {
  try {
    const delivery = await service.changeStatus(req.auth, req.authorization,
      req.validated.params.deliveryId, req.validated.body.status, req.validated.body.failureReason);
    return res.status(200).json({ delivery });
  } catch (error) { return next(error); }
}

async function cancel(req, res, next) {
  try {
    const delivery = await service.cancel(req.auth, req.authorization, req.validated.params.deliveryId);
    return res.status(200).json({ delivery });
  } catch (error) { return next(error); }
}

// Order calls this endpoint; it only reads Delivery's local database and never calls Order.
async function verifyAssignment(req, res, next) {
  try {
    const delivery = await repository.getAssignmentByOrderId(req.validated.params.orderId);
    if (!delivery || !delivery.delivery_person_id || delivery.status === 'CANCELLED') {
      return res.status(200).json({ assignment: null });
    }
    return res.status(200).json({ assignment: {
      delivery_id: Number(delivery.id),
      order_id: Number(delivery.order_id),
      delivery_person_user_id: Number(delivery.delivery_person_id),
      status: 'ACTIVE',
      delivery_status: delivery.status,
    } });
  } catch (error) { return next(error); }
}

// Order uses this internal read to validate a persisted transition before accepting sync.
async function internalStatus(req, res, next) {
  try {
    const delivery = await repository.getInternalStatus(req.validated.params.orderId);
    if (!delivery) throw new AppError(404, 'Delivery not found for this order.');
    return res.status(200).json({ delivery: {
      id: Number(delivery.id), order_id: Number(delivery.order_id),
      delivery_person_id: delivery.delivery_person_id == null ? null : Number(delivery.delivery_person_id),
      status: delivery.status,
    } });
  } catch (error) { return next(error); }
}

module.exports = { create, mine, forOrder, forRestaurant, all, get, assign, updateStatus, cancel, verifyAssignment, internalStatus };