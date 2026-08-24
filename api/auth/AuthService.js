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
const { getCollection, insertDoc, toObjectId, ObjectId } = require('../../lib/db');
const { prepareSet }                   = require('../../lib/validation/schemas');
const logger                           = require('../../lib/logger');

async function signup({ username, password, role = 'viewer' }) {
  if (!validateUsername(username)) throw new AppError('Invalid username format', 400);
  const hashed = await hashPassword(password);
  try {
    const user = await insertDoc(UserModel, { username, password: hashed, role });
    logger.info('user signed up', { username: user.username, role: user.role, uid: user._id });
    return { id: user._id, username: user.username, role: user.role, scopes: getScopesForRole(user.role) };
  } catch (e) {
    if (e.code === 11000) throw new AppError('Username taken', 409);
    throw e;
  }
}

// Unified login — verifies credentials once, issues both a cookie token (browser)
// and a Bearer access+refresh pair (API / mobile). Both are tied to the same
// deviceId so they share one SessionModel row and count as a single session.
// Cookie token embeds deviceId so logout can always find and revoke the session.
async function loginAll({ username, password }, deviceId = randomUUID()) {
  if (!validateUsername(username)) throw new AppError('Invalid credentials', 401);

  // +password projection: include password field that is normally excluded by callers
  const user = await getCollection(UserModel.collection).findOne(
    { username, isDeleted: false },
    { projection: { password: 1, username: 1, role: 1, isDeleted: 1 } }
  );

  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError('Invalid credentials', 401);
  }

  const now    = Math.floor(Date.now() / 1000);
  const scopes = getScopesForRole(user.role);
  const uid    = user._id.toString();

  const cookieToken = await signToken(
    { uid, role: user.role, scopes, deviceId, exp: now + COOKIE_TTL },
    sessionSecret
  );

  const accessToken = await signToken(
    { uid, role: user.role, scopes, deviceId, type: 'access', exp: now + ACCESS_TTL },
    sessionSecret
  );

  const refreshToken = await signToken(
    { uid, deviceId, type: 'refresh', exp: now + REFRESH_TTL },
    sessionSecret
  );

  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  await enforceSessionLimit(user._id, deviceId);
  await getCollection(SessionModel.collection).findOneAndUpdate(
    { owner: user._id, deviceId },
    {
      $set:         { tokenHash, expiresAt: new Date((now + REFRESH_TTL) * 1000), isRevoked: false, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
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

  const session = await getCollection(SessionModel.collection).findOne({
    owner: toObjectId(payload.uid), deviceId: payload.deviceId,
  });

  if (!session || session.isRevoked || session.expiresAt < new Date()) {
    throw new AppError('Session expired or revoked', 401);
  }

  const incomingHash = createHash('sha256').update(rawRefreshToken).digest('hex');
  if (session.tokenHash !== incomingHash) {
    await getCollection(SessionModel.collection).updateMany(
      { owner: toObjectId(payload.uid) },
      prepareSet(SessionModel, { isRevoked: true })
    );
    logger.warn('refresh token reuse detected — all sessions revoked', { uid: payload.uid, deviceId: payload.deviceId });
    throw new AppError('Compromised token detected. All sessions revoked.', 401);
  }

  const user = await getCollection(UserModel.collection).findOne(
    { _id: toObjectId(payload.uid) },
    { projection: { password: 0 } }
  );
  if (!user || user.isDeleted) throw new AppError('User no longer exists', 401);

  logger.info('tokens refreshed', { uid: payload.uid, deviceId: payload.deviceId });
  return issueTokenPair(user, session.deviceId);
}

async function revokeSession(userId, deviceId) {
  await getCollection(SessionModel.collection).updateOne(
    { owner: toObjectId(userId), deviceId },
    prepareSet(SessionModel, { isRevoked: true })
  );
  logger.info('session revoked', { uid: userId, deviceId });
}

// Before writing a new session slot, check whether this device already has an active
// session. If it does, this is a rotation — no new slot, no limit check. If it doesn't,
// we're opening a new slot: evict the oldest active session when at the cap.
// Uses a single $facet aggregation to answer both questions in one round-trip.
async function enforceSessionLimit(userId, deviceId) {
  const now     = new Date();
  const col     = getCollection(SessionModel.collection);
  const ownerId = userId instanceof ObjectId ? userId : toObjectId(String(userId));

  const [result] = await col.aggregate([
    { $match: { owner: ownerId, isRevoked: false, expiresAt: { $gt: now } } },
    {
      $facet: {
        thisDevice: [
          { $match:   { deviceId } },
          { $limit:   1 },
          { $project: { _id: 1 } },
        ],
        allActive: [
          { $sort:    { createdAt: 1 } },
          { $project: { _id: 1 } },
        ],
      },
    },
  ]).toArray();

  if (result.thisDevice.length > 0) return;

  if (result.allActive.length >= MAX_SESSIONS) {
    const oldest = result.allActive[0];
    logger.info('session limit reached, evicting oldest session', { uid: String(userId), evicting: String(oldest._id) });
    await col.deleteOne({ _id: oldest._id });
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
  await getCollection(SessionModel.collection).findOneAndUpdate(
    { owner: user._id, deviceId },
    {
      $set:         { tokenHash, expiresAt: new Date((now + REFRESH_TTL) * 1000), isRevoked: false, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return { accessToken, refreshToken, expiresIn: ACCESS_TTL, scopes };
}

module.exports = { signup, loginAll, refreshTokens, revokeSession, issueTokenPair, getScopesForRole };
