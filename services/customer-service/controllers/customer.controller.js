const service = require('../services/customer.service');

async function create(req, res, next) {
  try { return res.status(201).json({ customer: await service.create(req.auth, req.validated.body) }); }
  catch (error) { return next(error); }
}

async function getMine(req, res, next) {
  try { return res.status(200).json({ customer: await service.getMine(req.auth) }); }
  catch (error) { return next(error); }
}

async function updateMine(req, res, next) {
  try { return res.status(200).json({ customer: await service.updateMine(req.auth, req.validated.body) }); }
  catch (error) { return next(error); }
}

async function list(req, res, next) {
  try { return res.status(200).json(await service.listAll(req.validated.query)); }
  catch (error) { return next(error); }
}

async function getById(req, res, next) {
  try { return res.status(200).json({ customer: await service.getById(req.validated.params.customerId) }); }
  catch (error) { return next(error); }
}

async function setStatus(req, res, next) {
  try {
    const customer = await service.setStatus(req.validated.params.customerId, req.validated.body.status);
    return res.status(200).json({ customer });
  } catch (error) { return next(error); }
}

module.exports = { create, getMine, updateMine, list, getById, setStatus };