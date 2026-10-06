const service = require('../services/menu.service');

async function list(req, res, next) {
  try {
    return res.status(200).json(await service.list(req.restaurant.id, req.validated.query));
  } catch (error) { return next(error); }
}

async function get(req, res, next) {
  try {
    const item = await service.get(req.restaurant.id, req.validated.params.itemId);
    return res.status(200).json({ item });
  } catch (error) { return next(error); }
}

async function create(req, res, next) {
  try {
    const item = await service.create(req.restaurant.id, req.validated.body);
    return res.status(201).json({ item });
  } catch (error) { return next(error); }
}

async function update(req, res, next) {
  try {
    const item = await service.update(
      req.restaurant.id,
      req.validated.params.itemId,
      req.validated.body,
    );
    return res.status(200).json({ item });
  } catch (error) { return next(error); }
}

async function setAvailability(req, res, next) {
  try {
    const item = await service.setAvailability(
      req.restaurant.id,
      req.validated.params.itemId,
      req.validated.body.availability,
    );
    return res.status(200).json({ item });
  } catch (error) { return next(error); }
}

async function softDelete(req, res, next) {
  try {
    await service.softDelete(req.restaurant.id, req.validated.params.itemId);
    return res.status(204).end();
  } catch (error) { return next(error); }
}

module.exports = { list, get, create, update, setAvailability, softDelete };