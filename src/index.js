import fs from 'node:fs';
import { createRequire } from 'node:module';
import config from './config/index.js';
import { initDb } from './db/index.js';
import { loadPlugins } from './bot/pluginLoader.js';
import botManager from './bot/manager.js';
import { createApp } from './server/app.js';
import logger from './utils/logger.js';

const require = createRequire(import.meta.url);

async function main() {
  try {
    const baileysPkg = require('@whiskeysockets/baileys/package.json');
    logger.info({ baileysVersion: baileysPkg.version }, 'Baileys package resolved');
  } catch (err) {
    logger.error({ err: err.message }, 'Could not resolve baileys package.json');
  }

  // Ensure dirs
  for (const dir of [config.dataDir, config.sessionsDir, config.logsDir, config.publicDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  await initDb();
  await loadPlugins();
  await botManager.bootstrap();

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host }, 'ZoraBot server started');
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down...');
    server.close();
    for (const [id, session] of botManager.bots) {
      try {
        await session.stop();
      } catch {}
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error({ err: err.message }, 'Uncaught exception');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled rejection');
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
