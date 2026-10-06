const service = require('../services/address.service');

async function list(req, res, next) {
  try { return res.status(200).json(await service.listMine(req.auth)); }
  catch (error) { return next(error); }
}

async function get(req, res, next) {
  try {
    const address = await service.getMine(req.auth, req.validated.params.addressId);
    return res.status(200).json({ address });
  } catch (error) { return next(error); }
}

async function create(req, res, next) {
  try {
    const address = await service.create(req.auth, req.validated.body);
    return res.status(201).json({ address });
  } catch (error) { return next(error); }
}

async function update(req, res, next) {
  try {
    const address = await service.update(req.auth, req.validated.params.addressId, req.validated.body);
    return res.status(200).json({ address });
  } catch (error) { return next(error); }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.auth, req.validated.params.addressId);
    return res.status(204).end();
  } catch (error) { return next(error); }
}

async function setDefault(req, res, next) {
  try {
    const address = await service.setDefault(req.auth, req.validated.params.addressId);
    return res.status(200).json({ address });
  } catch (error) { return next(error); }
}

module.exports = { list, get, create, update, remove, setDefault };