'use strict';
const { randomUUID } = require('node:crypto');
const { sendJson } = require('../lib/http');

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

// single error sink — router catch block calls this; never leaks stack to client
function centralErrorHandler(err, req, res) {
  const requestId = randomUUID();
  console.error(`[error] requestId=${requestId}`, err);
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Internal server error';
  if (!res.headersSent) sendJson(res, statusCode, { error: message, requestId });
}

module.exports = { AppError, centralErrorHandler };
