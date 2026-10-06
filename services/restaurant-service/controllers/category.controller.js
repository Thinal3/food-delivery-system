const service = require('../services/category.service');

async function list(req, res, next) {
  try { return res.status(200).json({ categories: await service.list(req.restaurant.id) }); }
  catch (error) { return next(error); }
}

async function create(req, res, next) {
  try {
    const category = await service.create(req.restaurant.id, req.validated.body.name);
    return res.status(201).json({ category });
  } catch (error) { return next(error); }
}

async function update(req, res, next) {
  try {
    const category = await service.update(
      req.restaurant.id,
      req.validated.params.categoryId,
      req.validated.body.name,
    );
    return res.status(200).json({ category });
  } catch (error) { return next(error); }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.restaurant.id, req.validated.params.categoryId);
    return res.status(204).end();
  } catch (error) { return next(error); }
}

module.exports = { list, create, update, remove };