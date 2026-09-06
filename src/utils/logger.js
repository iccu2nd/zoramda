import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import config from '../config/index.js';

if (!fs.existsSync(config.logsDir)) {
  fs.mkdirSync(config.logsDir, { recursive: true });
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : {
    target: 'pino/file',
    options: { destination: 1 }
  },
  base: { app: 'zorabot' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'token', 'authState', 'creds', 'keys', 'secret', 'session'],
    censor: '[REDACTED]'
  }
});

export function createBotLogger(botId) {
  return logger.child({ botId });
}

export default logger;
