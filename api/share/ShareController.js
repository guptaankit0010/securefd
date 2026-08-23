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
  const { token, tokenId } = await ShareService.createShareToken(
    req.params.fileId, req.user.uid, body.expiresInSeconds
  );
  sendJson(res, 201, {
    token,
    tokenId,
    shareUrl: `${env.serverBaseUrl}/api/share/${token}`,
  });
}

async function list(req, res) {
  const tokens = await ShareService.listShareTokens(
    req.params.fileId, req.user.uid, req.user.role
  );
  sendJson(res, 200, { tokens });
}

async function revoke(req, res) {
  await ShareService.revokeShareToken(
    req.params.tokenId, req.params.fileId, req.user.uid, req.user.role
  );
  sendJson(res, 200, { message: 'Token revoked' });
}

async function download(req, res) {
  const file = await ShareService.resolveShareToken(req.params.token);
  const storagePath = path.join(env.storageDir, file.storageName);
  const readStream  = fs.createReadStream(storagePath);
  // iv and authTag are stored as BSON Binary by the native driver; coerce to Buffer
  const toBuf   = v => Buffer.isBuffer(v) ? v : Buffer.from(v.buffer ?? v);
  const decipher = createDecryptStream(toBuf(file.iv), toBuf(file.authTag));
  trackStream(readStream);
  trackStream(decipher);
  res.writeHead(200, {
    'Content-Type':        file.mimeType,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
  });
  readStream.pipe(decipher).pipe(res);
  readStream.on('error', () => { if (!res.headersSent) res.end(); });
}

module.exports = { create, list, revoke, download };
