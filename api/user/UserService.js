'use strict';

const UserModel    = require('./UserModel');
const SessionModel = require('../auth/SessionModel');
const { hashPassword }     = require('../../lib/crypto/password');
const { sanitizeMongoQuery, validateUsername } = require('../../lib/validation/sanitize');
const { AppError }         = require('../../middleware/errorHandler');
const { getCollection, insertDoc, toObjectId } = require('../../lib/db');
const { prepareSet }       = require('../../lib/validation/schemas');
const logger               = require('../../lib/logger');

async function findById(id) {
  const user = await getCollection(UserModel.collection).findOne(
    { _id: toObjectId(id), isDeleted: false },
    { projection: { password: 0 } }
  );
  if (!user) throw new AppError('User not found', 404);
  return user;
}

// Kept for any existing callers; superseded by updateUser for admin edits
async function updateRole(id, role) {
  const result = await getCollection(UserModel.collection).updateOne(
    { _id: toObjectId(id), isDeleted: false },
    prepareSet(UserModel, { role })
  );
  if (!result.matchedCount) throw new AppError('User not found', 404);
  logger.info('user role updated', { id, role });
}

async function listUsers({ page, limit, skip }) {
  const col   = getCollection(UserModel.collection);
  const filter = { isDeleted: false };
  const [users, total] = await Promise.all([
    col.find(filter, { projection: { password: 0 } })
       .sort({ createdAt: -1 })
       .skip(skip)
       .limit(limit)
       .toArray(),
    col.countDocuments(filter),
  ]);
  return { users, total, page, limit, pages: Math.ceil(total / limit) };
}

async function createUser({ username, password, role }) {
  if (!validateUsername(username)) throw new AppError('Invalid username format', 400);
  const hashed = await hashPassword(password);
  try {
    const user = await insertDoc(UserModel, { username, password: hashed, role });
    logger.info('user created by admin', { uid: user._id, username: user.username, role: user.role });
    return { id: user._id, username: user.username, role: user.role };
  } catch (e) {
    if (e.code === 11000) throw new AppError('Username taken', 409);
    throw e;
  }
}

async function updateUser(id, { username, password, role }) {
  const updates = {};
  const col = getCollection(UserModel.collection);
  const oid = toObjectId(id);

  if (username !== undefined) {
    if (!validateUsername(username)) throw new AppError('Invalid username format', 400);
    updates.username = username;
  }
  if (password !== undefined) updates.password = await hashPassword(password);
  if (role     !== undefined) updates.role     = role;

  if (Object.keys(updates).length === 0) throw new AppError('No fields to update', 400);

  try {
    const result = await col.updateOne({ _id: oid, isDeleted: false }, prepareSet(UserModel, updates));
    if (!result.matchedCount) throw new AppError('User not found', 404);
  } catch (e) {
    if (e.code === 11000) throw new AppError('Username already taken', 409);
    throw e;
  }
  logger.info('user updated by admin', { id, fields: Object.keys(updates) });
}

async function deleteUser(id) {
  const oid    = toObjectId(id);
  const result = await getCollection(UserModel.collection).updateOne(
    { _id: oid, isDeleted: false },
    prepareSet(UserModel, { isDeleted: true })
  );
  if (!result.matchedCount) throw new AppError('User not found', 404);
  await getCollection(SessionModel.collection).updateMany(
    { owner: oid },
    prepareSet(SessionModel, { isRevoked: true })
  );
  logger.info('user soft-deleted, sessions revoked', { id });
}

module.exports = { findById, updateRole, listUsers, createUser, updateUser, deleteUser };
