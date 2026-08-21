'use strict';
const { readJsonBody, sendJson, serializeCookie } = require('../../lib/http');
const { validate, SCHEMAS } = require('../../lib/validation/schemas');
const { signup, login } = require('./AuthService');

async function signupHandler(req, res) {
  const body = await readJsonBody(req);
  validate(body, SCHEMAS.signup);
  const user = await signup(body.username, body.password);
  sendJson(res, 201, { user });
}

async function loginHandler(req, res) {
  const body = await readJsonBody(req);
  validate(body, SCHEMAS.login);
  const { token, maxAge } = await login(body.username, body.password);
  res.setHeader('Set-Cookie', serializeCookie('__Host-session', token, {
    httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge,
  }));
  sendJson(res, 200, { message: 'Logged in' });
}

async function logoutHandler(_req, res) {
  res.setHeader('Set-Cookie', serializeCookie('__Host-session', '', {
    httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 0,
  }));
  sendJson(res, 200, { message: 'Logged out' });
}

module.exports = { signup: signupHandler, login: loginHandler, logout: logoutHandler };
