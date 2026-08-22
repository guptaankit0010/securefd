'use strict';
const fs     = require('node:fs');
const path   = require('node:path');
const { randomUUID } = require('node:crypto');
const Busboy = require('busboy');
const { createEncryptStream } = require('../../lib/crypto/fileCrypto');
const { AppError } = require('../../middleware/errorHandler');
const { assertSafePath } = require('../../lib/validation/sanitize');
const { validate, SCHEMAS } = require('../../lib/validation/schemas');
const FileModel = require('./FileModel');
const env = require('../../config/env');

// expected magic bytes for each allowed mimeType — content must match what the client declares
const MIME_SIGNATURES = {
  'text/plain':       null, // no fixed signature; validated by absence of any known binary signature below
  'application/json': null,
  'application/pdf':                                                        [Buffer.from('%PDF')],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [Buffer.from([0x50,0x4B,0x03,0x04])], // docx == zip container
};

// always-forbidden signatures, regardless of declared mimeType — never valid for any allowed type here
const FORBIDDEN_SIGS = [
  Buffer.from([0x4D,0x5A]),             // MZ  – PE (EXE/DLL)
  Buffer.from([0x7F,0x45,0x4C,0x46]),   // ELF
  Buffer.from([0x89,0x50,0x4E,0x47]),   // PNG
  Buffer.from('GIF8'),                   // GIF
];

// verifies the sniffed first chunk actually matches the mimeType the client declared in `meta`,
// so a client can't lie about mimeType to smuggle a different file type past validation
function matchesDeclaredType(chunk, mimeType) {
  if (FORBIDDEN_SIGS.some(s => chunk.slice(0, s.length).equals(s))) return false;

  const expected = MIME_SIGNATURES[mimeType];
  if (!expected) return true; // text/plain, application/json — no fixed signature to check beyond the forbidden list above
  return expected.some(s => chunk.slice(0, s.length).equals(s));
}

async function uploadFile(req, ownerId) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: env.maxFileSizeBytes, files: 1, fields: 1 } });
    let meta = null;
    let firstChunk = true;
    let bytesWritten = 0;

    bb.on('field', (name, val) => {
      if (name !== 'meta') return;
      try { meta = JSON.parse(val); validate(meta, SCHEMAS.fileMeta); }
      catch (e) { reject(new AppError(e.message || 'Invalid meta', 400)); }
    });

    bb.on('file', (_field, fileStream) => {
      if (!meta) {
        // Must drain the stream even though we're rejecting it — busboy pauses its
        // internal parser until this stream is consumed. Without this, the rest of
        // the request body is never read, leaving the socket in a bad state and
        // corrupting the next request on the same keep-alive connection.
        fileStream.resume();
        return reject(new AppError('meta field must precede file field', 400));
      }

      const storageName = randomUUID();
      const storagePath = path.join(env.storageDir, storageName);
      assertSafePath(storagePath);

      const { stream: cipher, iv, getAuthTag } = createEncryptStream();
      const dest = fs.createWriteStream(storagePath);
      const cleanup = () => { dest.destroy(); fs.unlink(storagePath, () => {}); };

      fileStream.on('data', chunk => {
        if (!firstChunk) { bytesWritten += chunk.length; return; }
        firstChunk = false;
        if (!matchesDeclaredType(chunk, meta.mimeType)) {
          fileStream.destroy(); cleanup();
          return reject(new AppError('File content does not match declared mimeType', 415));
        }
        bytesWritten += chunk.length;
      });

      fileStream.on('limit', () => { fileStream.destroy(); cleanup(); reject(new AppError('File too large', 413)); });

      fileStream.pipe(cipher).pipe(dest);

      dest.on('finish', async () => {
        try {
          const file = await FileModel.create({
            owner: ownerId, filename: meta.filename, storageName,
            mimeType: meta.mimeType, size: bytesWritten, iv, authTag: getAuthTag(),
          });
          resolve(file);
        } catch (e) { cleanup(); reject(e); }
      });

      fileStream.on('error', err => { cleanup(); reject(err); });
      dest.on('error',       err => { cleanup(); reject(err); });
    });

    bb.on('error', reject);
    req.pipe(bb);
  });
}

module.exports = { uploadFile };
