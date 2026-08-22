'use strict';

const { createHash, randomUUID } = require('node:crypto');
const UserModel    = require('../user/UserModel');
const SessionModel = require('./SessionModel');
const { hashPassword, verifyPassword } = require('../../lib/crypto/password');
const { signToken, verifyToken }       = require('../../lib/crypto/tokens');
const { sessionSecret }                = require('../../config/env');
const { validateUsername }             = require('../../lib/validation/sanitize');
const { AppError }                     = require('../../middleware/errorHandler');
const { COOKIE_TTL, ACCESS_TTL, REFRESH_TTL, MAX_SESSIONS, getScopesForRole } = require('../../config/auth');
const logger                           = require('../../lib/logger');

async function signup({ username, password, role = 'viewer' }) {
  if (!validateUsername(username)) throw new AppError('Invalid username format', 400);
  if (await UserModel.findOne({ username })) throw new AppError('Username taken', 409);
  const hashed = await hashPassword(password);
  const user   = await UserModel.create({ username, password: hashed, role });
  logger.info('user signed up', { username: user.username, role: user.role, uid: user._id });
  return { id: user._id, username: user.username, role: user.role, scopes: getScopesForRole(user.role) };
}

// Unified login — verifies credentials once, issues both a cookie token (browser)
// and a Bearer access+refresh pair (API / mobile). Both are tied to the same
// deviceId so they share one SessionModel row and count as a single session.
// Cookie token embeds deviceId so logout can always find and revoke the session.
async function loginAll({ username, password }, deviceId = randomUUID()) {
  if (!validateUsername(username)) throw new AppError('Invalid credentials', 401);
  const user = await UserModel.findOne({ username, isDeleted: false }).select('+password');
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError('Invalid credentials', 401);
  }

  const now    = Math.floor(Date.now() / 1000);
  const scopes = getScopesForRole(user.role);
  const uid    = user._id.toString();

  // Cookie token — long-lived; deviceId embedded so logout/revoke works on the cookie path too
  const cookieToken = await signToken(
    { uid, role: user.role, scopes, deviceId, exp: now + COOKIE_TTL },
    sessionSecret
  );

  // Bearer access token — short-lived, stateless
  const accessToken = await signToken(
    { uid, role: user.role, scopes, deviceId, type: 'access', exp: now + ACCESS_TTL },
    sessionSecret
  );

  // Bearer refresh token — long-lived, DB-backed
  const refreshToken = await signToken(
    { uid, deviceId, type: 'refresh', exp: now + REFRESH_TTL },
    sessionSecret
  );

  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  await enforceSessionLimit(user._id, deviceId);
  await SessionModel.findOneAndUpdate(
    { owner: user._id, deviceId },
    { tokenHash, expiresAt: new Date((now + REFRESH_TTL) * 1000), isRevoked: false },
    { upsert: true }
  );

  logger.info('user logged in', { uid, role: user.role, deviceId });
  return {
    cookieToken, cookieMaxAge: COOKIE_TTL,
    accessToken, refreshToken, expiresIn: ACCESS_TTL,
    scopes,
  };
}

async function refreshTokens(rawRefreshToken) {
  const payload = await verifyToken(rawRefreshToken, sessionSecret);
  if (payload.type !== 'refresh') throw new AppError('Invalid token type', 401);

  const session = await SessionModel.findOne({ owner: payload.uid, deviceId: payload.deviceId });
  if (!session || session.isRevoked || session.expiresAt < new Date()) {
    throw new AppError('Session expired or revoked', 401);
  }

  const incomingHash = createHash('sha256').update(rawRefreshToken).digest('hex');
  if (session.tokenHash !== incomingHash) {
    // Refresh token reuse detected — revoke all sessions for this user (breach response)
    await SessionModel.updateMany({ owner: payload.uid }, { isRevoked: true });
    logger.warn('refresh token reuse detected — all sessions revoked', { uid: payload.uid, deviceId: payload.deviceId });
    throw new AppError('Compromised token detected. All sessions revoked.', 401);
  }

  const user = await UserModel.findById(payload.uid);
  if (!user || user.isDeleted) throw new AppError('User no longer exists', 401);

  logger.info('tokens refreshed', { uid: payload.uid, deviceId: payload.deviceId });
  return issueTokenPair(user, session.deviceId);
}

async function revokeSession(userId, deviceId) {
  await SessionModel.updateOne({ owner: userId, deviceId }, { isRevoked: true });
  logger.info('session revoked', { uid: userId, deviceId });
}

// Before writing a new session slot, check whether this device already has an active
// session. If it does, this is a rotation — no new slot, no limit check. If it doesn't,
// we're opening a new slot: evict the oldest active session when at the cap.
async function enforceSessionLimit(userId, deviceId) {
  const now = new Date();
  const existing = await SessionModel.findOne({
    owner: userId, deviceId, isRevoked: false, expiresAt: { $gt: now },
  });
  if (existing) return; // same device re-logging in or rotating — just update in place

  const active = await SessionModel.find(
    { owner: userId, isRevoked: false, expiresAt: { $gt: now } },
    { _id: 1 }
  ).sort({ createdAt: 1 }); // oldest first

  if (active.length >= MAX_SESSIONS) {
    logger.info('session limit reached, evicting oldest session', { uid: String(userId), evicting: String(active[0]._id) });
    await SessionModel.deleteOne({ _id: active[0]._id }); // evict oldest
  }
}

async function issueTokenPair(user, deviceId) {
  const now    = Math.floor(Date.now() / 1000);
  const scopes = getScopesForRole(user.role);

  const accessToken = await signToken({
    uid: user._id.toString(),
    role: user.role,
    scopes,
    deviceId,
    type: 'access',
    exp: now + ACCESS_TTL,
  }, sessionSecret);

  const refreshToken = await signToken({
    uid: user._id.toString(),
    deviceId,
    type: 'refresh',
    exp: now + REFRESH_TTL,
  }, sessionSecret);

  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  await enforceSessionLimit(user._id, deviceId);
  await SessionModel.findOneAndUpdate(
    { owner: user._id, deviceId },
    { tokenHash, expiresAt: new Date((now + REFRESH_TTL) * 1000), isRevoked: false },
    { upsert: true }
  );

  return { accessToken, refreshToken, expiresIn: ACCESS_TTL, scopes };
}

module.exports = { signup, loginAll, refreshTokens, revokeSession, issueTokenPair, getScopesForRole };
