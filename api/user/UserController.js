'use strict';
const { readJsonBody, sendJson, parsePagination } = require('../../lib/http');
const { sanitizeBody } = require('../../lib/validation/sanitize');
const { validate, SCHEMAS } = require('../../lib/validation/schemas');
const UserService = require('./UserService');
const env = require('../../config/env');

async function getMe(req, res) {
  const { uid, role, scopes } = req.user;
  sendJson(res, 200, { user: { uid, role, scopes } });
}

async function listUsers(req, res) {
  const pagination = parsePagination(req, env.maxPageSize);
  const result = await UserService.listUsers(pagination);
  sendJson(res, 200, result);
}

async function createUser(req, res) {
  const body = sanitizeBody(await readJsonBody(req), SCHEMAS.createUser);
  validate(body, SCHEMAS.createUser);
  const user = await UserService.createUser(body);
  sendJson(res, 201, { user });
}

async function updateUser(req, res) {
  const body = sanitizeBody(await readJsonBody(req), SCHEMAS.updateUser);
  validate(body, SCHEMAS.updateUser);
  await UserService.updateUser(req.params.id, body);
  sendJson(res, 200, { message: 'User updated' });
}

async function deleteUser(req, res) {
  await UserService.deleteUser(req.params.id);
  sendJson(res, 200, { message: 'User deleted' });
}

module.exports = { getMe, listUsers, createUser, updateUser, deleteUser };
