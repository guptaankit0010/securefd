'use strict';

const { AppError } = require('./errorHandler');
const { getScopesForRole } = require('../config/auth');
    
// Enforces role checks (e.g., admin management)
function requireRole(...roles) {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError('Not authenticated', 401);
    if (!roles.includes(req.user.role)) {
      throw new AppError('Forbidden: Insufficient role privileges', 403);
    }
    await next();
  };
}

// Enforces granular scope checks (e.g., file:read, file:write, file:delete).
// Falls back to role-derived scopes for cookie tokens issued before the scope
// migration (max 8-hour window before they expire naturally).
function requireScope(requiredScope) {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError('Not authenticated', 401);

    // Prefer embedded scopes (Bearer tokens + updated cookie tokens).
    // Fall back to deriving scopes from role for old cookie tokens.
    const userScopes = req.user.scopes || getScopesForRole(req.user.role);

    if (!userScopes.includes(requiredScope)) {
      throw new AppError(`Forbidden: Missing required scope '${requiredScope}'`, 403);
    }
    await next();
  };
}

module.exports = { requireRole, requireScope };
