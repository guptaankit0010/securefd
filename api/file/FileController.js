'use strict';
const { sendJson } = require('../../lib/http');
const { AppError } = require('../../middleware/errorHandler');
const { signToken } = require('../../lib/crypto/tokens');
const FileService  = require('./FileService');
const FileModel    = require('./FileModel');
const ShareModel   = require('../share/ShareModel');
const env    = require('../../config/env');
const logger = require('../../lib/logger');

const FILE_PROJECTION = '-iv -authTag -storageName';

// Fetches all active (non-revoked, non-expired) share tokens and builds:
//   shareMap:     fileId (string) → signed token string
//   sharedFileIds: array of ObjectIds for use in queries
async function buildShareMap() {
  const now = new Date();
  const activeShares = await ShareModel.find(
    { revoked: false, expiresAt: { $gt: now } }
  ).lean();

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
// shareUrl expires at the same instant as the original share token.
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
    // Admin sees all non-deleted files
    rawFiles = await FileModel.find({ isDeleted: false }).select(FILE_PROJECTION).lean();
  } else {
    // Manager / Viewer: own non-deleted files + non-deleted files with active share tokens
    rawFiles = await FileModel.find({
      isDeleted: false,
      $or: [{ owner: req.user.uid }, { _id: { $in: sharedFileIds } }],
    }).select(FILE_PROJECTION).lean();
  }

  const files = attachShareUrls(rawFiles, shareMap);
  sendJson(res, 200, { files });
}

async function getOne(req, res) {
  const { fileId } = req.params;

  if (req.user.role === 'admin') {
    const file = await FileModel.findOne({ _id: fileId, isDeleted: false }).select(FILE_PROJECTION).lean();
    if (!file) throw new AppError('File not found', 404);

    // Attach shareUrl if there is an active share token for this file
    const { shareMap } = await buildShareMap();
    const [result] = attachShareUrls([file], shareMap);
    return sendJson(res, 200, { file: result });
  }

  // Manager / Viewer: own file, or accessible via active share token
  const now = new Date();
  let file = await FileModel.findOne({ _id: fileId, owner: req.user.uid, isDeleted: false })
    .select(FILE_PROJECTION).lean();

  if (file) {
    // Owned — check for a shareUrl to include
    const activeShare = await ShareModel.findOne({ file: fileId, revoked: false, expiresAt: { $gt: now } }).lean();
    if (activeShare) {
      const exp   = Math.floor(activeShare.expiresAt.getTime() / 1000);
      const token = await signToken({ fileId, tokenId: activeShare.tokenId, exp }, env.shareTokenSecret);
      file = { ...file, shareUrl: `${env.serverBaseUrl}/api/share/${token}` };
    }
    return sendJson(res, 200, { file });
  }

  // Not owned — check if accessible via share token
  const activeShare = await ShareModel.findOne({ file: fileId, revoked: false, expiresAt: { $gt: now } }).lean();
  if (!activeShare) throw new AppError('File not found', 404);

  file = await FileModel.findOne({ _id: fileId, isDeleted: false }).select(FILE_PROJECTION).lean();
  if (!file) throw new AppError('File not found', 404);

  const exp   = Math.floor(activeShare.expiresAt.getTime() / 1000);
  const token = await signToken({ fileId, tokenId: activeShare.tokenId, exp }, env.shareTokenSecret);
  sendJson(res, 200, { file: { ...file, shareUrl: `${env.serverBaseUrl}/api/share/${token}` } });
}

async function remove(req, res) {
  // Only the file owner can delete; admin has no file:delete scope (blocked by requireScope upstream)
  const file = await FileModel.findOne({ _id: req.params.fileId, owner: req.user.uid, isDeleted: false });
  if (!file) throw new AppError('File not found', 404);

  await FileModel.updateOne({ _id: file._id }, { isDeleted: true });
  await ShareModel.updateMany({ file: file._id }, { revoked: true });
  logger.info('file soft-deleted', { fileId: file._id, filename: file.filename, uid: req.user.uid });
  // Physical blob stays on disk (encrypted at rest); eligible for a future cleanup job
  sendJson(res, 200, { message: 'File deleted' });
}

module.exports = { upload, list, getOne, remove };
