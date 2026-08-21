'use strict';
const { verifyToken } = require('../lib/crypto/tokens');
const { parseCookies } = require('../lib/http');
const { AppError } = require('./errorHandler');
const { sessionSecret } = require('../config/env');

// must call next() so the router continues to the next handler in the array
async function requireAuth(req, _res, next) {
  const raw = parseCookies(req)['__Host-session'];
  if (!raw) throw new AppError('Not authenticated', 401);
  req.user = await verifyToken(raw, sessionSecret);
  await next();
}

module.exports = { requireAuth };
