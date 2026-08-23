'use strict';
const db     = require('./db');
const env    = require('../config/env');
const logger = require('./logger');

const activeStreams = new Set();

function trackStream(stream) {
  activeStreams.add(stream);
  const done = () => activeStreams.delete(stream);
  stream.once('close', done).once('finish', done).once('error', done);
}

async function shutdown(server) {
  logger.info('shutdown signal received — draining connections');
  server.close(async () => {
    if (activeStreams.size > 0) {
      logger.warn('active streams present, waiting for drain', { count: activeStreams.size });
      await new Promise(resolve => {
        const timer = setTimeout(() => {
          logger.warn('drain timeout reached, force-destroying streams', { count: activeStreams.size });
          activeStreams.forEach(s => s.destroy());
          resolve();
        }, env.shutdownTimeoutMs);
        const poll = setInterval(() => {
          if (!activeStreams.size) { clearTimeout(timer); clearInterval(poll); resolve(); }
        }, 100);
      });
    }
    await db.disconnect();
    logger.info('clean shutdown complete');
    process.exit(0);
  });
}

module.exports = { trackStream, shutdown };
