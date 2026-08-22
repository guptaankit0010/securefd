'use strict';

const { readJsonBody, sendJson, serializeCookie } = require('../../lib/http');
const { sanitizeBody } = require('../../lib/validation/sanitize');
const { validate, SCHEMAS } = require('../../lib/validation/schemas');
const { AppError } = require('../../middleware/errorHandler');
const AuthService = require('./AuthService');

async function signupHandler(req, res) {
  const body = sanitizeBody(await readJsonBody(req), SCHEMAS.signup);
  validate(body, SCHEMAS.signup);
  const user = await AuthService.signup(body);
  sendJson(res, 201, { user });
}

async function loginHandler(req, res) {
  const body     = sanitizeBody(await readJsonBody(req), SCHEMAS.login);
  validate(body, SCHEMAS.login);

  // Use client-supplied device ID if present; loginAll generates a UUID otherwise
  const deviceId = req.headers['x-device-id'] || undefined;
  const result   = await AuthService.loginAll(body, deviceId);

  res.setHeader('Set-Cookie', serializeCookie('__Host-session', result.cookieToken, {
    httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: result.cookieMaxAge,
  }));

  sendJson(res, 200, {
    message:      'Logged in successfully',
    accessToken:  result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn:    result.expiresIn,
    scopes:       result.scopes,
  });
}

async function refreshHandler(req, res) {
  const body = await readJsonBody(req);
  if (!body.refreshToken || typeof body.refreshToken !== 'string') {
    throw new AppError('refreshToken string required in body', 400);
  }
  const result = await AuthService.refreshTokens(body.refreshToken);
  sendJson(res, 200, {
    accessToken:  result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn:    result.expiresIn,
    scopes:       result.scopes,
  });
}

async function logoutHandler(req, res) {
  // Bearer path: revoke the session in the DB
  if (req.user && req.user.uid && req.user.deviceId) {
    await AuthService.revokeSession(req.user.uid, req.user.deviceId);
  }
  // Cookie path: clear the cookie regardless of which transport was used
  res.setHeader('Set-Cookie', serializeCookie('__Host-session', '', {
    httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 0,
  }));
  sendJson(res, 200, { message: 'Logged out successfully' });
}

module.exports = { signup: signupHandler, login: loginHandler, refresh: refreshHandler, logout: logoutHandler };
