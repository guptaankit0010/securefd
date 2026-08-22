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
  Buffer.from([0x50,0x4B,0x03,0x04]),   // ZIP (docx == zip container)
  Buffer.from([0x52,0x61,0x72,0x21]),   // RAR
  Buffer.from([0x1F,0x8B]),             // GZIP
];

// every signature that belongs to *some* known type — used to catch a client declaring
// a "no fixed signature" type (text/plain, application/json) while uploading a different
// known file type's content (e.g. declaring text/plain but uploading a real PDF)
const ALL_KNOWN_SIGS = [...FORBIDDEN_SIGS, ...Object.values(MIME_SIGNATURES).filter(Boolean).flat()];

// verifies the sniffed first chunk actually matches the mimeType the client declared in `meta`,
// so a client can't lie about mimeType to smuggle a different file type past validation
function matchesDeclaredType(chunk, mimeType) {
  const expected = MIME_SIGNATURES[mimeType];
  if (expected) return expected.some(s => chunk.slice(0, s.length).equals(s));
  // no fixed signature declared (text/plain, application/json) — reject if content
  // actually matches any OTHER known type's signature (forbidden or otherwise)
  return !ALL_KNOWN_SIGS.some(s => chunk.slice(0, s.length).equals(s));
}

// cap on how many (meta, file) pairs a single upload request may contain
const MAX_FILES_PER_UPLOAD = 10;

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
          return failFile(new AppError('File content does not match declared mimeType', 415));
        }
        bytesWritten += chunk.length;
      });

      fileStream.on('limit', () => failFile(new AppError('File too large', 413)));

      fileStream.pipe(cipher).pipe(dest);

      dest.on('finish', async () => {
        if (settledThisFile) return;
        try {
          const file = await FileModel.create({
            owner: ownerId, filename: meta.filename, storageName,
            mimeType: meta.mimeType, size: bytesWritten, iv, authTag: getAuthTag(),
          });
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
