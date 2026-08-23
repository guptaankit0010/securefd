'use strict';
const fs     = require('node:fs');
const path   = require('node:path');
const { randomUUID } = require('node:crypto');
const Busboy = require('busboy');
const { createEncryptStream } = require('../../lib/crypto/fileCrypto');
const { AppError } = require('../../middleware/errorHandler');
const { assertSafePath } = require('../../lib/validation/sanitize');
const { validate, SCHEMAS } = require('../../lib/validation/schemas');
const { insertDoc }         = require('../../lib/db');
const FileModel = require('./FileModel');
const env    = require('../../config/env');
const logger = require('../../lib/logger');

// Only two mimeTypes are accepted. Neither has a fixed binary magic header.
// Validation strategy: reject the file if its first chunk contains bytes that
// cannot appear in valid UTF-8 text (null bytes, C0/C1 control chars, lone
// high bytes that aren't valid UTF-8 lead/continuation bytes, etc.).
const ALLOWED_MIME_TYPES = new Set(['text/plain', 'application/json']);

// Returns true if the buffer looks like valid UTF-8 text.
// Rejects immediately on any byte that has no place in a text or JSON file.
function looksLikeText(chunk) {
  let i = 0;
  while (i < chunk.length) {
    const b = chunk[i];
    // Null byte — never valid in text/json
    if (b === 0x00) return false;
    // C0 control chars except tab (0x09), LF (0x0A), CR (0x0D)
    if (b < 0x09 || (b > 0x0D && b < 0x20)) return false;
    // DEL
    if (b === 0x7F) return false;

    // Multi-byte UTF-8 sequences
    let extra = 0;
    if      ((b & 0xE0) === 0xC0) extra = 1; // 110x xxxx
    else if ((b & 0xF0) === 0xE0) extra = 2; // 1110 xxxx
    else if ((b & 0xF8) === 0xF0) extra = 3; // 1111 0xxx
    else if  (b > 0x7F)           return false; // lone high byte — invalid

    for (let j = 1; j <= extra; j++) {
      if (i + j >= chunk.length) break; // continuation bytes may be in next chunk — give benefit of doubt at boundary
      if ((chunk[i + j] & 0xC0) !== 0x80) return false; // expected 10xx xxxx continuation
    }
    i += 1 + extra;
  }
  return true;
}

// Returns true only if the content is consistent with the declared mimeType.
// Any mimeType not on the allowlist is rejected before even reaching this function
// (schema validator enforces the enum), but we guard here too for defence-in-depth.
function matchesDeclaredType(chunk, mimeType) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return false;
  return looksLikeText(chunk);
}

// cap on how many (meta, file) pairs a single upload request may contain
const MAX_FILES_PER_UPLOAD = env.maxFilesPerUpload;

// Uploads one or more files from a single multipart request. Each file part must be
// preceded by its own `meta` field (same "meta must precede file" contract as before,
// just repeated per pair: meta1, file1, meta2, file2, ...).
//
// Best-effort semantics: one file failing (bad mimeType, oversized, disk error, etc.)
// does not abort the others — every part gets its own entry in the returned array:
//   { success: true,  file: <FileModel doc> }
//   { success: false, filename, error, statusCode }
async function uploadFile(req, ownerId) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: env.maxFileSizeBytes, files: MAX_FILES_PER_UPLOAD, fields: MAX_FILES_PER_UPLOAD },
    });

    const results = [];          // one entry per file part, in arrival order
    let pendingMeta = null;      // validated meta waiting to be consumed by the next file part
    let pendingMetaError = null; // set when the most recently seen meta field failed validation
    let pendingWork = 0;         // count of files whose async write/DB work hasn't settled yet
    let bbFinished = false;

    // resolves once busboy has fully parsed the request AND every file's async work has settled
    const maybeResolve = () => { if (bbFinished && pendingWork === 0) resolve(results); };

    bb.on('field', (name, val) => {
      if (name !== 'meta') return;
      try {
        pendingMeta = JSON.parse(val);
        validate(pendingMeta, SCHEMAS.fileMeta);
        pendingMetaError = null;
      } catch (e) {
        pendingMeta = null;
        pendingMetaError = e.message || 'Invalid meta';
      }
    });

    bb.on('file', (_field, fileStream, info) => {
      const meta = pendingMeta;
      const metaError = pendingMetaError;
      pendingMeta = null;
      pendingMetaError = null;

      if (!meta) {
        // Must drain the stream even though we're rejecting it — busboy pauses its
        // internal parser until this stream is consumed. Without this, the rest of
        // the request body is never read, leaving the socket in a bad state and
        // corrupting the next request on the same keep-alive connection.
        fileStream.resume();
        results.push({ success: false, filename: info && info.filename, error: metaError || 'meta field must precede file field', statusCode: 400 });
        return;
      }

      pendingWork++;
      let firstChunk = true;
      let bytesWritten = 0;
      let settledThisFile = false;

      const storageName = randomUUID();
      const storagePath = path.join(env.storageDir, storageName);

      const failFile = (error) => {
        if (settledThisFile) return;
        settledThisFile = true;
        cleanup();
        results.push({ success: false, filename: meta.filename, error: error.message || String(error), statusCode: error.statusCode || 500 });
        pendingWork--;
        maybeResolve();
      };

      try {
        assertSafePath(storagePath);
      } catch (e) {
        fileStream.resume();
        pendingWork--;
        results.push({ success: false, filename: meta.filename, error: e.message, statusCode: e.statusCode || 400 });
        maybeResolve();
        return;
      }

      const { stream: cipher, iv, getAuthTag } = createEncryptStream();
      const dest = fs.createWriteStream(storagePath);
      const cleanup = () => {
        // Detach + drain rather than destroy: busboy's parser still expects to push the
        // remaining bytes of this part into fileStream, and keeps a reference to it
        // internally. Destroying fileStream mid-part leaves busboy's push() permanently
        // returning false (backpressure) with nothing left to drain it, which stalls
        // busboy's writable forever — hanging the ENTIRE request (including any other
        // files already succeeding in the same multipart body), not just this one file.
        // Draining lets busboy reach this part's closing boundary naturally so parsing
        // (and therefore the request) can finish.
        fileStream.unpipe(cipher);
        fileStream.resume();
        cipher.destroy();
        dest.destroy();
        fs.unlink(storagePath, () => {});
      };

      fileStream.on('data', chunk => {
        if (!firstChunk) { bytesWritten += chunk.length; return; }
        firstChunk = false;
        if (!matchesDeclaredType(chunk, meta.mimeType)) {
          logger.warn('file content does not match declared mimeType', { filename: meta.filename, mimeType: meta.mimeType });
          return failFile(new AppError('File content does not match declared mimeType', 415));
        }
        bytesWritten += chunk.length;
      });

      fileStream.on('limit', () => failFile(new AppError('File too large', 413)));

      fileStream.pipe(cipher).pipe(dest);

      dest.on('finish', async () => {
        if (settledThisFile) return;
        try {
          const file = await insertDoc(FileModel, {
            owner: ownerId, filename: meta.filename, storageName,
            mimeType: meta.mimeType, size: bytesWritten, iv, authTag: getAuthTag(),
          });
          logger.info('file uploaded', { fileId: file._id, filename: file.filename, mimeType: file.mimeType, size: file.size, owner: ownerId });
          settledThisFile = true;
          results.push({ success: true, file });
          pendingWork--;
          maybeResolve();
        } catch (e) { failFile(e); }
      });

      fileStream.on('error', failFile);
      cipher.on('error',     failFile);
      dest.on('error',       failFile);
    });

    bb.on('filesLimit',  () => results.push({ success: false, error: `Too many files in one request (max ${MAX_FILES_PER_UPLOAD})`, statusCode: 413 }));
    bb.on('fieldsLimit', () => results.push({ success: false, error: `Too many meta fields in one request (max ${MAX_FILES_PER_UPLOAD})`, statusCode: 413 }));

    bb.on('finish', () => { bbFinished = true; maybeResolve(); });
    bb.on('error', reject); // malformed multipart body itself — nothing per-file to salvage
    req.pipe(bb);
  });
}

module.exports = { uploadFile };
