import './db/index.js'; // ensure DB + schema are ready before anything else
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { loadPlugins } from './plugins/loader.js';
import { authRouter } from './api/routes/auth.routes.js';
import { botsRouter } from './api/routes/bots.routes.js';
import { errorHandler, notFoundHandler } from './api/middlewares/errorHandler.js';
import { botManager } from './bots/bot-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await loadPlugins();

  const app = express();
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        styleSrc: ["'self'", 'https://cdnjs.cloudflare.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:']
      }
    }
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.use('/api/auth', authRouter);
  app.use('/api/bots', botsRouter);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'ZoraBot server listening');
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await botManager.shutdownAll();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err: err.message }, 'fatal startup error');
  process.exit(1);
});
