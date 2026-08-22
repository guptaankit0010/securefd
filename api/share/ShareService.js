'use strict';
const { randomUUID } = require('node:crypto');
const { signToken, verifyToken } = require('../../lib/crypto/tokens');
const { shareTokenSecret }       = require('../../config/env');
const { AppError }               = require('../../middleware/errorHandler');
const ShareModel = require('./ShareModel');
const FileModel  = require('../file/FileModel');
const logger     = require('../../lib/logger');

async function createShareToken(fileId, ownerId, expiresInSeconds) {
  const file = await FileModel.findOne({ _id: fileId, owner: ownerId, isDeleted: false });
  if (!file) throw new AppError('File not found', 404);
  const tokenId = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  await ShareModel.create({ file: fileId, tokenId, expiresAt: new Date(exp * 1000) });
  const token = await signToken({ fileId, tokenId, exp }, shareTokenSecret);
  logger.info('share token created', { fileId, ownerId, tokenId, expiresInSeconds });
  return { token };
}

async function resolveShareToken(rawToken) {
  // verifyToken checks HMAC signature (timingSafeEqual) and exp claim
  const payload = await verifyToken(rawToken, shareTokenSecret);
  const share = await ShareModel.findOne({ tokenId: payload.tokenId, revoked: false });
  if (!share || share.expiresAt < new Date()) throw new AppError('Token invalid or expired', 401);
  const file = await FileModel.findOne({ _id: payload.fileId, isDeleted: false });
  if (!file) throw new AppError('File not found', 404);
  logger.info('share token resolved', { fileId: payload.fileId, tokenId: payload.tokenId });
  return file;
}

async function revokeShareToken(tokenId, fileId, ownerId) {
  const file = await FileModel.findOne({ _id: fileId, owner: ownerId });
  if (!file) throw new AppError('File not found', 404);
  const result = await ShareModel.updateOne({ tokenId, file: fileId }, { revoked: true });
  if (!result.matchedCount) throw new AppError('Token not found', 404);
  logger.info('share token revoked', { fileId, tokenId, ownerId });
}

module.exports = { createShareToken, resolveShareToken, revokeShareToken };
