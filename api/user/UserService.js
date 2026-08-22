'use strict';
const UserModel    = require('./UserModel');
const SessionModel = require('../auth/SessionModel');
const { hashPassword } = require('../../lib/crypto/password');
const { sanitizeMongoQuery } = require('../../lib/validation/sanitize');
const { validateUsername }   = require('../../lib/validation/sanitize');
const { AppError }           = require('../../middleware/errorHandler');
const logger                 = require('../../lib/logger');

async function findById(id) {
  const user = await UserModel.findOne(sanitizeMongoQuery({ _id: id, isDeleted: false }));
  if (!user) throw new AppError('User not found', 404);
  return user;
}

// Kept for any existing callers; superseded by updateUser for admin edits
async function updateRole(id, role) {
  const result = await UserModel.updateOne(
    sanitizeMongoQuery({ _id: id, isDeleted: false }),
    { role }
  );
  if (!result.matchedCount) throw new AppError('User not found', 404);
  logger.info('user role updated', { id, role });
}

async function listUsers() {
  return UserModel.find({ isDeleted: false }).select('-password');
}

async function createUser({ username, password, role }) {
  if (!validateUsername(username)) throw new AppError('Invalid username format', 400);
  if (await UserModel.findOne({ username })) throw new AppError('Username taken', 409);
  const hashed = await hashPassword(password);
  const user   = await UserModel.create({ username, password: hashed, role });
  logger.info('user created by admin', { uid: user._id, username: user.username, role: user.role });
  return { id: user._id, username: user.username, role: user.role };
}

async function updateUser(id, { username, password, role }) {
  const updates = {};
  if (username !== undefined) {
    if (!validateUsername(username)) throw new AppError('Invalid username format', 400);
    const clash = await UserModel.findOne({ username, _id: { $ne: id } });
    if (clash) throw new AppError('Username already taken', 409);
    updates.username = username;
  }
  if (password !== undefined) updates.password = await hashPassword(password);
  if (role     !== undefined) updates.role     = role;

  if (Object.keys(updates).length === 0) throw new AppError('No fields to update', 400);

  const result = await UserModel.updateOne(
    sanitizeMongoQuery({ _id: id, isDeleted: false }),
    updates
  );
  if (!result.matchedCount) throw new AppError('User not found', 404);
  logger.info('user updated by admin', { id, fields: Object.keys(updates) });
}

async function deleteUser(id) {
  const result = await UserModel.updateOne(
    sanitizeMongoQuery({ _id: id, isDeleted: false }),
    { isDeleted: true }
  );
  if (!result.matchedCount) throw new AppError('User not found', 404);
  // Immediately revoke all active sessions so the deleted user is kicked out
  await SessionModel.updateMany({ owner: id }, { isRevoked: true });
  logger.info('user soft-deleted, sessions revoked', { id });
}

module.exports = { findById, updateRole, listUsers, createUser, updateUser, deleteUser };
