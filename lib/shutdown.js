'use strict';
const mongoose = require('mongoose');

const activeStreams = new Set();
const FORCE_EXIT_MS = 10_000;

function trackStream(stream) {
  activeStreams.add(stream);
  const done = () => activeStreams.delete(stream);
  stream.once('close', done).once('finish', done).once('error', done);
}

async function shutdown(server) {
  console.log('[shutdown] signal received — draining...');
  server.close(async () => {
    if (activeStreams.size > 0) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { activeStreams.forEach(s => s.destroy()); resolve(); }, FORCE_EXIT_MS);
        const poll  = setInterval(() => {
          if (!activeStreams.size) { clearTimeout(timer); clearInterval(poll); resolve(); }
        }, 100);
      });
    }
    await mongoose.disconnect();
    console.log('[shutdown] clean exit');
    process.exit(0);
  });
}

module.exports = { trackStream, shutdown };
