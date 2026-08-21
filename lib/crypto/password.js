'use strict';
const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { measureAsync } = require('../perf');

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

async function hashPassword(plaintext) {
  return measureAsync('scrypt-hash', async () => {
    const salt = randomBytes(16).toString('hex');
    const key = await scryptAsync(plaintext, salt, KEYLEN);
    return `${salt}:${key.toString('hex')}`;
  });
}

async function verifyPassword(plaintext, stored) {
  return measureAsync('scrypt-verify', async () => {
    const [salt, hash] = stored.split(':');
    const key = await scryptAsync(plaintext, salt, KEYLEN);
    return timingSafeEqual(key, Buffer.from(hash, 'hex'));
  });
}

module.exports = { hashPassword, verifyPassword };
