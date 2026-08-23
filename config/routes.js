'use strict';

const { requireAuth }                = require('../middleware/session');
const { requireRole, requireScope }  = require('../middleware/rbac');
const AuthCtrl  = require('../api/auth/AuthController');
const UserCtrl  = require('../api/user/UserController');
const FileCtrl  = require('../api/file/FileController');
const ShareCtrl = require('../api/share/ShareController');

const routes = [
  // Public auth endpoints
  { path: '/api/auth/signup',  method: 'POST', handlers: [AuthCtrl.signup] },
  { path: '/api/auth/login',   method: 'POST', handlers: [AuthCtrl.login] },
  { path: '/api/auth/refresh', method: 'POST', handlers: [AuthCtrl.refresh] },
  { path: '/api/auth/logout',  method: 'POST', handlers: [requireAuth, AuthCtrl.logout] },

  // Current user
  { path: '/api/users/me', method: 'GET', handlers: [requireAuth, UserCtrl.getMe] },

  // Admin user management
  { path: '/api/users',        method: 'GET',    handlers: [requireAuth, requireRole('admin'), UserCtrl.listUsers] },
  { path: '/api/users',        method: 'POST',   handlers: [requireAuth, requireRole('admin'), UserCtrl.createUser] },
  { path: '/api/users/:id',    method: 'PATCH',  handlers: [requireAuth, requireRole('admin'), UserCtrl.updateUser] },
  { path: '/api/users/:id',    method: 'DELETE', handlers: [requireAuth, requireRole('admin'), UserCtrl.deleteUser] },

  // Scope-guarded file operations
  { path: '/api/files',            method: 'POST',   handlers: [requireAuth, requireScope('file:write'),  FileCtrl.upload] },
  { path: '/api/files',            method: 'GET',    handlers: [requireAuth, requireScope('file:read'),   FileCtrl.list] },
  { path: '/api/files/:fileId',    method: 'GET',    handlers: [requireAuth, requireScope('file:read'),   FileCtrl.getOne] },
  { path: '/api/files/:fileId',    method: 'DELETE', handlers: [requireAuth, requireScope('file:delete'), FileCtrl.remove] },

  // Scope-guarded sharing operations
  { path: '/api/files/:fileId/share',          method: 'POST',   handlers: [requireAuth, requireScope('file:write'),  ShareCtrl.create] },
  { path: '/api/files/:fileId/share',          method: 'GET',    handlers: [requireAuth, requireScope('file:read'),   ShareCtrl.list] },
  { path: '/api/files/:fileId/share/:tokenId', method: 'DELETE', handlers: [requireAuth, requireScope('file:delete'), ShareCtrl.revoke] },
  { path: '/api/share/:token',                 method: 'GET',    handlers: [ShareCtrl.download] },
];

function registerRoutes(router) {
  for (const route of routes) {
    router.addRoute(route);
  }
}

module.exports = { routes, registerRoutes };
