'use strict';
const { readJsonBody, sendJson } = require('../../lib/http');
const { validate, SCHEMAS } = require('../../lib/validation/schemas');
const UserService = require('./UserService');

async function getMe(req, res) {
  // Return only the identity fields — strip internal token claims (type, exp, deviceId)
  const { uid, role, scopes } = req.user;
  sendJson(res, 200, { user: { uid, role, scopes } });
}

async function updateRole(req, res) {
  const body = await readJsonBody(req);
  validate(body, SCHEMAS.roleUpdate);
  await UserService.updateRole(req.params.id, body.role);
  sendJson(res, 200, { message: 'Role updated' });
}

module.exports = { getMe, updateRole };