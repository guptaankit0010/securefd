'use strict';

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const LEVEL_NAMES = { 10: 'DEBUG', 20: 'INFO', 30: 'WARN', 40: 'ERROR' };

// Honour LOG_LEVEL env var (default INFO in production, DEBUG otherwise)
const configuredLevel = LEVELS[(process.env.LOG_LEVEL || '').toUpperCase()] ??
  (process.env.NODE_ENV === 'production' ? LEVELS.INFO : LEVELS.DEBUG);

function write(level, message, ctx) {
  if (level < configuredLevel) return;
  const entry = {
    ts:    new Date().toISOString(),
    level: LEVEL_NAMES[level],
    msg:   message,
  };
  if (ctx !== undefined && ctx !== null) {
    if (ctx instanceof Error) {
      entry.err = { message: ctx.message, stack: ctx.stack, code: ctx.code };
    } else {
      Object.assign(entry, ctx);
    }
  }
  const line = JSON.stringify(entry);
  if (level >= LEVELS.ERROR) {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const logger = {
  debug: (msg, ctx) => write(LEVELS.DEBUG, msg, ctx),
  info:  (msg, ctx) => write(LEVELS.INFO,  msg, ctx),
  warn:  (msg, ctx) => write(LEVELS.WARN,  msg, ctx),
  error: (msg, ctx) => write(LEVELS.ERROR, msg, ctx),
};

module.exports = logger;
