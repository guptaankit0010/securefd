'use strict';

const env = require('./env');

// Token lifetimes — values come from .env (COOKIE_TTL_SECONDS, ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS)
const COOKIE_TTL  = env.cookieTtl;
const ACCESS_TTL  = env.accessTtl;
const REFRESH_TTL = env.refreshTtl;

// Role → scope mapping (ABAC)
const ROLE_SCOPES = {
  manager: ['file:read', 'file:write', 'file:delete'],
  admin:   ['file:read', 'file:write', 'file:delete'],
  viewer:  ['file:read'],
};

function getScopesForRole(role) {
  return ROLE_SCOPES[role] || ['file:read'];
}

// Max concurrent active sessions per user — value comes from .env (MAX_SESSIONS)
const MAX_SESSIONS = env.maxSessions;

module.exports = { COOKIE_TTL, ACCESS_TTL, REFRESH_TTL, ROLE_SCOPES, getScopesForRole, MAX_SESSIONS };
