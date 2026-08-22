'use strict';
const fs   = require('node:fs');
const path = require('node:path');
const { readJsonBody, sendJson } = require('../../lib/http');
const { validate, SCHEMAS } = require('../../lib/validation/schemas');
const { trackStream } = require('../../lib/shutdown');
const { createDecryptStream } = require('../../lib/crypto/fileCrypto');
const ShareService = require('./ShareService');
const env = require('../../config/env');

async function create(req, res) {
  const body = await readJsonBody(req);
  validate(body, SCHEMAS.shareCreate);
  const { token } = await ShareService.createShareToken(req.params.fileId, req.user.uid, body.expiresInSeconds);
  sendJson(res, 201, {
    token,
    shareUrl: `${env.serverBaseUrl}/api/share/${token}`,
  });
}

async function revoke(req, res) {
  await ShareService.revokeShareToken(req.params.tokenId, req.params.fileId, req.user.uid);
  sendJson(res, 200, { message: 'Token revoked' });
}

async function download(req, res) {
  const file = await ShareService.resolveShareToken(req.params.token);
  const storagePath = path.join(env.storageDir, file.storageName);
  const readStream = fs.createReadStream(storagePath);
  const decipher   = createDecryptStream(file.iv, file.authTag);
  trackStream(readStream);
  trackStream(decipher);
  res.writeHead(200, {
    'Content-Type': file.mimeType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
  });
  readStream.pipe(decipher).pipe(res);
  readStream.on('error', () => { if (!res.headersSent) res.end(); });
}

module.exports = { create, revoke, download };
