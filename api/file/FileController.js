'use strict';

const { sendJson, parsePagination } = require('../../lib/http');
const { AppError }  = require('../../middleware/errorHandler');
const { signToken } = require('../../lib/crypto/tokens');
const FileService   = require('./FileService');
const FileModel     = require('./FileModel');
const ShareModel    = require('../share/ShareModel');
const { getCollection, toObjectId } = require('../../lib/db');
const { prepareSet }                = require('../../lib/validation/schemas');
const env    = require('../../config/env');
const logger = require('../../lib/logger');

// Projection that omits sensitive storage fields from API responses
const FILE_PROJECTION = { iv: 0, authTag: 0, storageName: 0 };

// Signs the share URL for a single share doc.
async function toShareUrl(share) {
  const exp   = Math.floor(share.expiresAt.getTime() / 1000);
  const token = await signToken(
    { fileId: share.file.toString(), tokenId: share.tokenId, exp },
    env.shareTokenSecret
  );
  return `${env.serverBaseUrl}/api/share/${token}`;
}

// Aggregation pipeline: fetches files and left-joins the first active share token for each.
// Works on an already-scoped $match filter — no global sharetokens scan.
async function fetchFilesWithShare(matchFilter, { skip, limit }) {
  const now = new Date();
  return getCollection(FileModel.collection).aggregate([
    { $match: matchFilter },
    { $sort:  { createdAt: -1 } },
    { $skip:  skip  },
    { $limit: limit },
    {
      $lookup: {
        from: 'sharetokens',
        let:  { fid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr:     { $eq: ['$file', '$$fid'] },
              revoked:   false,
              expiresAt: { $gt: now },
            },
          },
          { $sort:  { createdAt: -1 } },
          { $limit: 1 },
        ],
        as: 'activeShare',
      },
    },
    { $addFields: { activeShare: { $first: '$activeShare' } } },
    { $project: FILE_PROJECTION },  // exclusion-only; activeShare from $lookup passes through automatically
  ]).toArray();
}

// Strips the embedded activeShare subdoc and attaches a signed shareUrl in its place.
async function attachShareUrls(rawFiles) {
  return Promise.all(rawFiles.map(async f => {
    const { activeShare, ...file } = f;
    if (!activeShare) return file;
    return { ...file, shareUrl: await toShareUrl(activeShare) };
  }));
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
  const { page, limit, skip } = parsePagination(req, env.maxPageSize);

  const matchFilter = req.user.role === 'admin'
    ? { isDeleted: false }
    : { isDeleted: false, $or: [{ owner: toObjectId(req.user.uid) }] };

  // For non-admin: also include files shared with them via active tokens — injected server-side
  // by the $lookup, so no need to pre-fetch all sharedFileIds.
  // We still need the $or to be open to shared files; we add a second branch pointing at the
  // lookup result in a post-filter. Simpler approach: fetch owned + count, then fetch shared
  // separately. Actually, cleanest: two-branch $or with a facet for total count.
  // For now: owner branch only in $match, shared files appended via a second query below.

  let rawFiles;
  let total;

  if (req.user.role === 'admin') {
    const filter = { isDeleted: false };
    [rawFiles, total] = await Promise.all([
      fetchFilesWithShare(filter, { skip, limit }),
      getCollection(FileModel.collection).countDocuments(filter),
    ]);
  } else {
    const ownerOid = toObjectId(req.user.uid);
    const now      = new Date();
    // Get IDs of files the user can access via active share tokens
    const sharedIds = await getCollection(ShareModel.collection)
      .distinct('file', { revoked: false, expiresAt: { $gt: now } });

    const filter = {
      isDeleted: false,
      $or: [{ owner: ownerOid }, ...(sharedIds.length ? [{ _id: { $in: sharedIds } }] : [])],
    };
    [rawFiles, total] = await Promise.all([
      fetchFilesWithShare(filter, { skip, limit }),
      getCollection(FileModel.collection).countDocuments(filter),
    ]);
  }

  const files = await attachShareUrls(rawFiles);
  sendJson(res, 200, { files, total, page, limit, pages: Math.ceil(total / limit) });
}

async function getOne(req, res) {
  const { fileId } = req.params;
  const fileOid    = toObjectId(fileId);
  const now        = new Date();

  // Single-file fetch with inline share token join — no global shareMap scan
  const [raw] = await fetchFilesWithShare(
    { _id: fileOid, isDeleted: false },
    { skip: 0, limit: 1 }
  );
  if (!raw) throw new AppError('File not found', 404);

  // Access control: admin sees any file; others must own it or have a share token
  if (req.user.role !== 'admin') {
    const isOwner  = raw.owner.toString() === req.user.uid;
    const isShared = !!raw.activeShare;
    if (!isOwner && !isShared) throw new AppError('File not found', 404);
  }

  const [file] = await attachShareUrls([raw]);
  sendJson(res, 200, { file });
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
