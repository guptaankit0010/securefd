'use strict';
const { performance } = require('node:perf_hooks');
const logger = require('./logger');

async function measureAsync(label, fn) {
  const start = performance.now();
  try { return await fn(); }
  finally { logger.debug('perf', { label, ms: parseFloat((performance.now() - start).toFixed(2)) }); }
}

module.exports = { measureAsync };
