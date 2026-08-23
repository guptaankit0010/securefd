'use strict';

const { randomUUID } = require('node:crypto');
const { signToken, verifyToken } = require('../../lib/crypto/tokens');
const { shareTokenSecret }       = require('../../config/env');
const { AppError }               = require('../../middleware/errorHandler');
const ShareModel = require('./ShareModel');
const FileModel  = require('../file/FileModel');
const { getCollection, insertDoc, toObjectId } = require('../../lib/db');
const { prepareSet }             = require('../../lib/validation/schemas');
const logger                     = require('../../lib/logger');

async function createShareToken(fileId, ownerId, expiresInSeconds) {
  const fileOid  = toObjectId(fileId);
  const ownerOid = toObjectId(ownerId);

  const file = await getCollection(FileModel.collection).findOne({
    _id: fileOid, owner: ownerOid, isDeleted: false,
  });
  if (!file) throw new AppError('File not found', 404);

  const tokenId = randomUUID();
  const exp     = Math.floor(Date.now() / 1000) + expiresInSeconds;

  await insertDoc(ShareModel, { file: fileOid, tokenId, expiresAt: new Date(exp * 1000) });

  const token = await signToken({ fileId, tokenId, exp }, shareTokenSecret);
  logger.info('share token created', { fileId, ownerId, tokenId, expiresInSeconds });
  // Return tokenId so callers can store it and use it for revocation later
  return { token, tokenId };
}

async function resolveShareToken(rawToken) {
  const payload = await verifyToken(rawToken, shareTokenSecret);

  const share = await getCollection(ShareModel.collection).findOne({
    tokenId: payload.tokenId, revoked: false,
  });
  if (!share || share.expiresAt < new Date()) throw new AppError('Token invalid or expired', 401);

  const file = await getCollection(FileModel.collection).findOne({
    _id: toObjectId(payload.fileId), isDeleted: false,
  });
  if (!file) throw new AppError('File not found', 404);

  logger.info('share token resolved', { fileId: payload.fileId, tokenId: payload.tokenId });
  return file;
}

// Lists all active (non-revoked, non-expired) share tokens for a file.
// Admins can list tokens for any file; others must own the file.
async function listShareTokens(fileId, userId, role) {
  const fileOid = toObjectId(fileId);
  const fileCol = getCollection(FileModel.collection);
  const filter  = role === 'admin'
    ? { _id: fileOid, isDeleted: false }
    : { _id: fileOid, owner: toObjectId(userId), isDeleted: false };

  const file = await fileCol.findOne(filter);
  if (!file) throw new AppError('File not found', 404);

  const now    = new Date();
  const tokens = await getCollection(ShareModel.collection)
    .find(
      { file: fileOid, revoked: false, expiresAt: { $gt: now } },
      { projection: { tokenId: 1, expiresAt: 1, createdAt: 1, _id: 0 } }
    )
    .sort({ createdAt: -1 })
    .toArray();

  return tokens;
}

// Revokes a share token.
// Admins may revoke tokens on any file; file owners may only revoke tokens on their own files.
async function revokeShareToken(tokenId, fileId, userId, role) {
  const fileOid  = toObjectId(fileId);
  const fileCol  = getCollection(FileModel.collection);
  const filter   = role === 'admin'
    ? { _id: fileOid, isDeleted: false }
    : { _id: fileOid, owner: toObjectId(userId), isDeleted: false };

  const file = await fileCol.findOne(filter);
  if (!file) throw new AppError('File not found', 404);

  const result = await getCollection(ShareModel.collection).updateOne(
    { tokenId, file: fileOid },
    prepareSet(ShareModel, { revoked: true })
  );
  if (!result.matchedCount) throw new AppError('Token not found', 404);
  logger.info('share token revoked', { fileId, tokenId, userId, role });
}

module.exports = { createShareToken, resolveShareToken, listShareTokens, revokeShareToken };
