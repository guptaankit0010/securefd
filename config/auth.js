'use strict';

// Token lifetimes in seconds
const COOKIE_TTL  = 8 * 60 * 60;      // 8 hours   (cookie / legacy path)
const ACCESS_TTL  = 15 * 60;          // 15 minutes (Bearer access token)
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 days    (Bearer refresh token)

// Role → scope mapping (ABAC)
// manager : full file access
// admin   : read + write, but NOT delete
// viewer  : read-only
const ROLE_SCOPES = {
  manager: ['file:read', 'file:write', 'file:delete'],
  admin:   ['file:read', 'file:write'],
  viewer:  ['file:read'],
};

function getScopesForRole(role) {
  return ROLE_SCOPES[role] || ['file:read'];
}

// Max concurrent active sessions per user (Bearer + cookie, all devices combined)
const MAX_SESSIONS = 2;

module.exports = { COOKIE_TTL, ACCESS_TTL, REFRESH_TTL, ROLE_SCOPES, getScopesForRole, MAX_SESSIONS };
