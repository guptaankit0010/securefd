'use strict';
const fs   = require('node:fs');
const path = require('node:path');
const { sendJson } = require('../../lib/http');
const { AppError } = require('../../middleware/errorHandler');
const FileService = require('./FileService');
const FileModel   = require('./FileModel');
const ShareModel  = require('../share/ShareModel');
const env = require('../../config/env');

async function upload(req, res) {
  const results = await FileService.uploadFile(req, req.user.uid);
  if (results.length === 0) throw new AppError('No files uploaded', 400);

  const files = results.map(r => r.success
    ? { success: true, file: { id: r.file._id, filename: r.file.filename, mimeType: r.file.mimeType, size: r.file.size } }
    : { success: false, filename: r.filename, error: r.error });

  const successCount = files.filter(f => f.success).length;
  // 201 all succeeded, 400 all failed, 207 (Multi-Status) mixed results
  const statusCode = successCount === files.length ? 201 : successCount === 0 ? 400 : 207;

  sendJson(res, statusCode, { files });
}

async function list(req, res) {
  const query = req.user.role === 'admin' ? {} : { owner: req.user.uid };
  const files = await FileModel.find(query).select('-iv -authTag -storageName');
  sendJson(res, 200, { files });
}

async function getOne(req, res) {
  const query = req.user.role === 'admin'
    ? { _id: req.params.fileId }
    : { _id: req.params.fileId, owner: req.user.uid };
  const file = await FileModel.findOne(query).select('-iv -authTag -storageName');
  if (!file) throw new AppError('File not found', 404);
  sendJson(res, 200, { file });
}

async function remove(req, res) {
  const query = req.user.role === 'admin'
    ? { _id: req.params.fileId }
    : { _id: req.params.fileId, owner: req.user.uid };
  const file = await FileModel.findOne(query);
  if (!file) throw new AppError('File not found', 404);
  const storagePath = path.join(env.storageDir, file.storageName);
  await FileModel.deleteOne({ _id: file._id });
  await ShareModel.deleteMany({ file: file._id });
  fs.unlink(storagePath, () => {}); // best-effort; doc already deleted
  sendJson(res, 200, { message: 'File deleted' });
}

module.exports = { upload, list, getOne, remove };
