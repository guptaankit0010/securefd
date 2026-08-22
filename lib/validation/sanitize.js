'use strict';
const path = require('node:path');
const { storageDir } = require('../../config/env');

// throws if resolved path escapes storageDir — prevents path traversal
function assertSafePath(filePath) {
  const resolved = path.resolve(filePath);
  const base     = path.resolve(storageDir);
  if (!resolved.startsWith(base + path.sep))
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 });
}

// strips keys starting with '$' or containing '.' to block NoSQL operator injection
function sanitizeMongoQuery(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => !k.startsWith('$') && !k.includes('.'))
      .map(([k, v]) => [k, typeof v === 'object' ? sanitizeMongoQuery(v) : v])
  );
}

function sanitizeBody(data, schema) {
  if (!data || typeof data !== 'object') return data;

  const sanitized = {};
  for (const [field, rules] of Object.entries(schema)) {
    if (!(field in data)) continue;

    let value = data[field];
    if (typeof value === 'string') {
      value = value.trim();
    }

    if (rules.type === 'string' && typeof value === 'string') {
      sanitized[field] = value;
      continue;
    }

    sanitized[field] = value;
  }

  return sanitized;
}

// ReDoS-safe: fixed character class, no catastrophic backtracking possible
const SAFE_USERNAME = /^[a-zA-Z0-9_-]{3,32}$/;
const validateUsername = str => SAFE_USERNAME.test(str);

module.exports = { assertSafePath, sanitizeBody, sanitizeMongoQuery, validateUsername };
