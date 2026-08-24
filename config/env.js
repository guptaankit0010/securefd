'use strict';
const REQUIRED = ['MONGODB_URI','SESSION_SECRET','SHARE_TOKEN_SECRET','FILE_ENCRYPTION_KEY','STORAGE_DIR','MAX_FILE_SIZE_BYTES'];
for (const k of REQUIRED) {
  if (!process.env[k]) throw new Error(`Missing required env var: ${k}`);
}

const port = Number(process.env.PORT) || 4433;

module.exports = {
  port,
  mongoUri:          process.env.MONGODB_URI,
  sessionSecret:     Buffer.from(process.env.SESSION_SECRET, 'hex'),
  shareTokenSecret:  Buffer.from(process.env.SHARE_TOKEN_SECRET, 'hex'),
  fileEncryptionKey: Buffer.from(process.env.FILE_ENCRYPTION_KEY, 'hex'),
  storageDir:        process.env.STORAGE_DIR,
  maxFileSizeBytes:  Number(process.env.MAX_FILE_SIZE_BYTES),
  allowedOrigin:     process.env.ALLOWED_ORIGIN     || 'https://localhost:3000',
  serverBaseUrl:     process.env.SERVER_BASE_URL    || `https://localhost:${port}`,

  // Token lifetimes (seconds)
  cookieTtl:         Number(process.env.COOKIE_TTL_SECONDS)  || 28800,   // 8 h
  accessTtl:         Number(process.env.ACCESS_TTL_SECONDS)  || 900,     // 15 min
  refreshTtl:        Number(process.env.REFRESH_TTL_SECONDS) || 604800,  // 7 d

  // Session cap
  maxSessions:       Number(process.env.MAX_SESSIONS)         || 2,

  // Upload limits
  maxFilesPerUpload: Number(process.env.MAX_FILES_PER_UPLOAD) || 10,

  // Share token expiry window (seconds)
  shareTokenMinExpiry: Number(process.env.SHARE_TOKEN_MIN_EXPIRY) || 60,
  shareTokenMaxExpiry: Number(process.env.SHARE_TOKEN_MAX_EXPIRY) || 604800,

  // Graceful shutdown drain timeout (ms)
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000,

  // Pagination
  maxPageSize: Number(process.env.MAX_PAGE_SIZE) || 100,
};
