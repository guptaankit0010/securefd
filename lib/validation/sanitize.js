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

// Accepts plain usernames (3–32 chars: letters, digits, _ -)
// AND email addresses (local@domain, up to 254 chars per RFC 5321).
// ReDoS-safe: no nested quantifiers, no catastrophic backtracking.
const SAFE_USERNAME = /^[a-zA-Z0-9_-]{3,32}$/;
const SAFE_EMAIL    = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
const validateUsername = str =>
  typeof str === 'string' && str.length <= 254 && (SAFE_USERNAME.test(str) || SAFE_EMAIL.test(str));

module.exports = { assertSafePath, sanitizeBody, sanitizeMongoQuery, validateUsername };
