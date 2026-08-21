'use strict';
const UserModel = require('./UserModel');
const { sanitizeMongoQuery } = require('../../lib/validation/sanitize');
const { AppError } = require('../../middleware/errorHandler');

async function findById(id) {
  const user = await UserModel.findOne(sanitizeMongoQuery({ _id: id, isDeleted: false }));
  if (!user) throw new AppError('User not found', 404);
  return user;
}

async function updateRole(id, role) {
  const result = await UserModel.updateOne(
    sanitizeMongoQuery({ _id: id, isDeleted: false }),
    { role }
  );
  if (!result.matchedCount) throw new AppError('User not found', 404);
}

module.exports = { findById, updateRole };
