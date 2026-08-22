'use strict';

const { verifyToken } = require('../lib/crypto/tokens');
const { parseCookies } = require('../lib/http');
const { AppError } = require('./errorHandler');
const { sessionSecret } = require('../config/env');

async function requireAuth(req, _res, next) {
  const authHeader = req.headers.authorization || '';

  if (authHeader.startsWith('Bearer ')) {
    // Bearer dual-token path (API / mobile clients)
    const token = authHeader.slice(7).trim();
    const payload = await verifyToken(token, sessionSecret);
    if (payload.type !== 'access') {
      throw new AppError('Invalid token type: Expected access token', 401);
    }
    req.user = payload;
  } else {
    // Cookie path (browser clients)
    const raw = parseCookies(req)['__Host-session'];
    if (!raw) throw new AppError('Not authenticated: No Bearer token or session cookie', 401);
    req.user = await verifyToken(raw, sessionSecret);
  }

  await next();
}

module.exports = { requireAuth };
