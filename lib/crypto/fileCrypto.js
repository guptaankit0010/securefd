'use strict';
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { fileEncryptionKey } = require('../../config/env');

// returns cipher Transform stream + iv; call getAuthTag() after stream 'finish'
function createEncryptStream() {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', fileEncryptionKey, iv);
  return { stream: cipher, iv, getAuthTag: () => cipher.getAuthTag() };
}

// iv and authTag must come from the File Mongo doc, never from the request
function createDecryptStream(iv, authTag) {
  const decipher = createDecipheriv('aes-256-gcm', fileEncryptionKey, iv);
  decipher.setAuthTag(authTag);
  return decipher;
}

module.exports = { createEncryptStream, createDecryptStream };
