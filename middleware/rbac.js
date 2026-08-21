'use strict';
const { AppError } = require('./errorHandler');

function requireRole(...roles) {
  return async (req, _res, next) => {
    if (!req.user)                      throw new AppError('Not authenticated', 401);
    if (!roles.includes(req.user.role)) throw new AppError('Forbidden', 403);
    await next();
  };
}

module.exports = { requireRole };
