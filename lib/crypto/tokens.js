'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');
const { measureAsync } = require('../perf');

// payload -> "<base64url-payload>.<base64url-sig>"
async function signToken(payload, secret) {
  return measureAsync('token-sign', () => {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${sig}`;
  });
}

// throws with statusCode 401 on bad signature or expired exp claim
async function verifyToken(token, secret) {
  return measureAsync('token-verify', () => {
    const [data, sig] = (token || '').split('.');
    if (!data || !sig) throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
    const expected = createHmac('sha256', secret).update(data).digest();
    const actual   = Buffer.from(sig, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() / 1000 > payload.exp)
      throw Object.assign(new Error('Token expired'), { statusCode: 401 });
    return payload;
  });
}

module.exports = { signToken, verifyToken };
