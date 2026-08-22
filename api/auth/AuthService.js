'use strict';
const UserModel = require('../user/UserModel');
const { hashPassword, verifyPassword } = require('../../lib/crypto/password');
const { signToken } = require('../../lib/crypto/tokens');
const { sessionSecret } = require('../../config/env');
const { validateUsername } = require('../../lib/validation/sanitize');
const { AppError } = require('../../middleware/errorHandler');

const SESSION_TTL = 8 * 60 * 60; // 8 h in seconds

async function signup({ username, password, role = 'viewer' }) {
  if (!validateUsername(username)) throw new AppError('Invalid username format', 400);
  if (await UserModel.findOne({ username })) throw new AppError('Username taken', 409);
  const hashed = await hashPassword(password);
  const user = await UserModel.create({ username, password: hashed, role });
  return { id: user._id, username: user.username, role: user.role };
}

async function login({ username, password }) {
  // same error for "not found" and "wrong password" — prevents user enumeration
  if (!validateUsername(username)) throw new AppError('Invalid credentials', 401);
  const user = await UserModel.findOne({ username, isDeleted: false }).select('+password');
  if (!user || !(await verifyPassword(password, user.password)))
    throw new AppError('Invalid credentials', 401);
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const token = await signToken({ uid: user._id.toString(), role: user.role, exp }, sessionSecret);
  return { token, maxAge: SESSION_TTL };
}

module.exports = { signup, login };
