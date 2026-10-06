const service = require('../services/restaurant.service');

async function list(req, res, next) {
  try { return res.status(200).json(await service.listPublic(req.validated.query)); }
  catch (error) { return next(error); }
}

async function mine(req, res, next) {
  try { return res.status(200).json(await service.listMine(req.auth, req.validated.query)); }
  catch (error) { return next(error); }
}

async function get(req, res, next) {
  try { return res.status(200).json({ restaurant: req.restaurant }); }
  catch (error) { return next(error); }
}

async function create(req, res, next) {
  try {
    const restaurant = await service.create(req.auth, req.get('authorization'), req.validated.body);
    return res.status(201).json({ restaurant });
  } catch (error) { return next(error); }
}

async function update(req, res, next) {
  try {
    const restaurant = await service.update(req.restaurant.id, req.validated.body);
    return res.status(200).json({ restaurant });
  } catch (error) { return next(error); }
}

async function setStatus(req, res, next) {
  try {
    const restaurant = await service.setStatus(req.restaurant.id, req.validated.body.status);
    return res.status(200).json({ restaurant });
  } catch (error) { return next(error); }
}

async function setOperatingStatus(req, res, next) {
  try {
    const restaurant = await service.setOperatingStatus(
      req.restaurant.id,
      req.validated.body.operatingStatus,
    );
    return res.status(200).json({ restaurant });
  } catch (error) { return next(error); }
}

async function deactivate(req, res, next) {
  try {
    await service.deactivate(req.restaurant.id);
    return res.status(204).end();
  } catch (error) { return next(error); }
}

module.exports = { list, mine, get, create, update, setStatus, setOperatingStatus, deactivate };