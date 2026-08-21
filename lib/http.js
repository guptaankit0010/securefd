'use strict';

function readJsonBody(req, limitBytes = 65536) {
  return new Promise((resolve, reject) => {
    let raw = '', bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limitBytes) { req.destroy(); return reject(Object.assign(new Error('Body too large'), { statusCode: 413 })); }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serializeCookie(name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (opts.httpOnly)       str += '; HttpOnly';
  if (opts.secure)         str += '; Secure';
  if (opts.sameSite)       str += `; SameSite=${opts.sameSite}`;
  if (opts.path)           str += `; Path=${opts.path}`;
  if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
  return str;
}

// returns plain object from Cookie header; never eval'd or used as regex
function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';')
      .map(p => { const [k, ...v] = p.trim().split('='); return [k, decodeURIComponent(v.join('='))]; })
      .filter(([k]) => k)
  );
}

module.exports = { readJsonBody, sendJson, serializeCookie, parseCookies };
