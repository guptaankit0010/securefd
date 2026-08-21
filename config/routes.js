'use strict';

const { requireAuth } = require('../middleware/session');
const { requireRole } = require('../middleware/rbac');

const AuthCtrl  = require('../api/auth/AuthController');
const UserCtrl  = require('../api/user/UserController');
const FileCtrl  = require('../api/file/FileController');
const ShareCtrl = require('../api/share/ShareController');

const routes = [
  { path: '/api/auth/signup', method: 'POST', handlers: [AuthCtrl.signup] },
  { path: '/api/auth/login', method: 'POST', handlers: [AuthCtrl.login] },
  { path: '/api/auth/logout', method: 'POST', handlers: [AuthCtrl.logout] },

  { path: '/api/users/me', method: 'GET', handlers: [requireAuth, UserCtrl.getMe] },
  { path: '/api/users/:id/role', method: 'PATCH', handlers: [requireAuth, requireRole('admin'), UserCtrl.updateRole] },

  { path: '/api/files', method: 'POST', handlers: [requireAuth, requireRole('admin', 'manager'), FileCtrl.upload] },
  { path: '/api/files', method: 'GET', handlers: [requireAuth, requireRole('admin', 'manager'), FileCtrl.list] },
  { path: '/api/files/:fileId', method: 'GET', handlers: [requireAuth, requireRole('admin', 'manager'), FileCtrl.getOne] },
  { path: '/api/files/:fileId', method: 'DELETE', handlers: [requireAuth, requireRole('admin', 'manager'), FileCtrl.remove] },

  { path: '/api/files/:fileId/share', method: 'POST', handlers: [requireAuth, requireRole('admin', 'manager'), ShareCtrl.create] },
  { path: '/api/files/:fileId/share/:tokenId', method: 'DELETE', handlers: [requireAuth, requireRole('admin', 'manager'), ShareCtrl.revoke] },
  { path: '/api/share/:token', method: 'GET', handlers: [ShareCtrl.download] },
];

function registerRoutes(router) {
  for (const route of routes) {
    router.addRoute(route);
  }
}

module.exports = { routes, registerRoutes };
