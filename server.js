'use strict';
process.loadEnvFile(); // native .env loader (Node >= 20.6) — must be first line before any require

const https    = require('node:https');
const fs       = require('node:fs');
const mongoose = require('mongoose');
const env      = require('./config/env');
const { Router }              = require('./lib/router');
const { centralErrorHandler } = require('./middleware/errorHandler');
const { shutdown }            = require('./lib/shutdown');
const { registerRoutes }      = require('./config/routes');
const { handleCors }          = require('./lib/http');
const logger                  = require('./lib/logger');

fs.mkdirSync(env.storageDir, { recursive: true });

const router = new Router();
registerRoutes(router);
router.init(); // compile regex for all registered routes

const sslOptions = { key: fs.readFileSync('./cert/key.pem'), cert: fs.readFileSync('./cert/cert.pem') };
const server = https.createServer(sslOptions, async (req, res) => {
  if (handleCors(req, res, env.allowedOrigin)) return;
  await router.handle(req, res).catch(err => centralErrorHandler(err, req, res));
});

mongoose.connect(env.mongoUri).then(() => {
  server.listen(env.port, 'localhost', () =>
    logger.info('server started', { url: `https://localhost:${env.port}` })
  );
});

// Keep signal handlers at module level — they must register even if DB never connects
process.on('SIGTERM', () => shutdown(server));
process.on('SIGINT',  () => shutdown(server));
