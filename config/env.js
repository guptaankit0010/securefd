'use strict';
const REQUIRED = ['MONGODB_URI','SESSION_SECRET','SHARE_TOKEN_SECRET','FILE_ENCRYPTION_KEY','STORAGE_DIR','MAX_FILE_SIZE_BYTES'];
for (const k of REQUIRED) {
  if (!process.env[k]) throw new Error(`Missing required env var: ${k}`);
}
module.exports = {
  port:              Number(process.env.PORT) || 4433,
  mongoUri:          process.env.MONGODB_URI,
  sessionSecret:     Buffer.from(process.env.SESSION_SECRET, 'hex'),
  shareTokenSecret:  Buffer.from(process.env.SHARE_TOKEN_SECRET, 'hex'),
  fileEncryptionKey: Buffer.from(process.env.FILE_ENCRYPTION_KEY, 'hex'),
  storageDir:        process.env.STORAGE_DIR,
  maxFileSizeBytes:  Number(process.env.MAX_FILE_SIZE_BYTES),
  allowedOrigin:     process.env.ALLOWED_ORIGIN || 'https://localhost:3000',
  serverBaseUrl:     process.env.SERVER_BASE_URL || `https://localhost:${Number(process.env.PORT) || 4433}`,
};
