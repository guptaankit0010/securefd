'use strict';
const { performance } = require('node:perf_hooks');

async function measureAsync(label, fn) {
  const start = performance.now();
  try { return await fn(); }
  finally { console.log(`[perf] ${label}: ${(performance.now() - start).toFixed(2)}ms`); }
}

module.exports = { measureAsync };
