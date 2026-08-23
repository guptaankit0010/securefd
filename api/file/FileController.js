'use strict';

const { sendJson } = require('../../lib/http');
const { AppError } = require('../../middleware/errorHandler');
const { signToken } = require('../../lib/crypto/tokens');
const FileService  = require('./FileService');
const FileModel    = require('./FileModel');
const ShareModel   = require('../share/ShareModel');
const { getCollection, toObjectId } = require('../../lib/db');
const { prepareSet }                = require('../../lib/validation/schemas');
const env    = require('../../config/env');
const logger = require('../../lib/logger');

// Projection that omits sensitive storage fields from API responses
const FILE_PROJECTION = { iv: 0, authTag: 0, storageName: 0 };

// Fetches all active (non-revoked, non-expired) share tokens and builds:
//   shareMap:      fileId (string) → signed token string
//   sharedFileIds: array of ObjectIds for use in queries
async function buildShareMap() {
  const now = new Date();
  const activeShares = await getCollection(ShareModel.collection)
    .find({ revoked: false, expiresAt: { $gt: now } })
    .toArray();

  const shareMap = {};
  for (const share of activeShares) {
    const fid = share.file.toString();
    if (!shareMap[fid]) {
      const exp = Math.floor(share.expiresAt.getTime() / 1000);
      // Deterministic re-sign: same payload + same secret = same token string as original
      shareMap[fid] = await signToken(
        { fileId: fid, tokenId: share.tokenId, exp },
        env.shareTokenSecret
      );
    }
  }

  const sharedFileIds = activeShares.map(s => s.file);
  return { shareMap, sharedFileIds };
}

// Attaches shareUrl to each file object that has an entry in shareMap.
function attachShareUrls(files, shareMap) {
  return files.map(f => {
    const token = shareMap[f._id.toString()];
    if (!token) return f;
    return { ...f, shareUrl: `${env.serverBaseUrl}/api/share/${token}` };
  });
}

async function upload(req, res) {
  const results = await FileService.uploadFile(req, req.user.uid);
  if (results.length === 0) throw new AppError('No files uploaded', 400);

  const files = results.map(r => r.success
    ? { success: true, file: { id: r.file._id, filename: r.file.filename, mimeType: r.file.mimeType, size: r.file.size } }
    : { success: false, filename: r.filename, error: r.error });

  const successCount = files.filter(f => f.success).length;
  logger.info('upload request completed', { uid: req.user.uid, total: files.length, succeeded: successCount, failed: files.length - successCount });
  const statusCode = successCount === files.length ? 201 : successCount === 0 ? 400 : 207;
  sendJson(res, statusCode, { files });
}

async function list(req, res) {
  const { shareMap, sharedFileIds } = await buildShareMap();

  let rawFiles;
  if (req.user.role === 'admin') {
    rawFiles = await getCollection(FileModel.collection)
      .find({ isDeleted: false }, { projection: FILE_PROJECTION })
      .toArray();
  } else {
    const ownerOid = toObjectId(req.user.uid);
    rawFiles = await getCollection(FileModel.collection)
      .find(
        { isDeleted: false, $or: [{ owner: ownerOid }, { _id: { $in: sharedFileIds } }] },
        { projection: FILE_PROJECTION }
      )
      .toArray();
  }

  const files = attachShareUrls(rawFiles, shareMap);
  sendJson(res, 200, { files });
}

async function getOne(req, res) {
  const { fileId } = req.params;
  const fileOid    = toObjectId(fileId);
  const fileCol    = getCollection(FileModel.collection);
  const shareCol   = getCollection(ShareModel.collection);

  if (req.user.role === 'admin') {
    const file = await fileCol.findOne({ _id: fileOid, isDeleted: false }, { projection: FILE_PROJECTION });
    if (!file) throw new AppError('File not found', 404);

    const { shareMap } = await buildShareMap();
    const [result] = attachShareUrls([file], shareMap);
    return sendJson(res, 200, { file: result });
  }

  // Manager / Viewer: own file, or accessible via active share token
  const now = new Date();
  let file = await fileCol.findOne(
    { _id: fileOid, owner: toObjectId(req.user.uid), isDeleted: false },
    { projection: FILE_PROJECTION }
  );

  if (file) {
    const activeShare = await shareCol.findOne({ file: fileOid, revoked: false, expiresAt: { $gt: now } });
    if (activeShare) {
      const exp   = Math.floor(activeShare.expiresAt.getTime() / 1000);
      const token = await signToken({ fileId, tokenId: activeShare.tokenId, exp }, env.shareTokenSecret);
      file = { ...file, shareUrl: `${env.serverBaseUrl}/api/share/${token}` };
    }
    return sendJson(res, 200, { file });
  }

  // Not owned — check if accessible via share token
  const activeShare = await shareCol.findOne({ file: fileOid, revoked: false, expiresAt: { $gt: now } });
  if (!activeShare) throw new AppError('File not found', 404);

  file = await fileCol.findOne({ _id: fileOid, isDeleted: false }, { projection: FILE_PROJECTION });
  if (!file) throw new AppError('File not found', 404);

  const exp   = Math.floor(activeShare.expiresAt.getTime() / 1000);
  const token = await signToken({ fileId, tokenId: activeShare.tokenId, exp }, env.shareTokenSecret);
  sendJson(res, 200, { file: { ...file, shareUrl: `${env.serverBaseUrl}/api/share/${token}` } });
}

async function remove(req, res) {
  const fileOid = toObjectId(req.params.fileId);
  const fileCol = getCollection(FileModel.collection);

  const file = await fileCol.findOne({ _id: fileOid, owner: toObjectId(req.user.uid), isDeleted: false });
  if (!file) throw new AppError('File not found', 404);

  await fileCol.updateOne({ _id: fileOid }, prepareSet(FileModel, { isDeleted: true }));
  await getCollection(ShareModel.collection).updateMany({ file: fileOid }, prepareSet(ShareModel, { revoked: true }));
  logger.info('file soft-deleted', { fileId: fileOid, filename: file.filename, uid: req.user.uid });
  sendJson(res, 200, { message: 'File deleted' });
}

module.exports = { upload, list, getOne, remove };
