import pino from 'pino';
import { config } from '../config/index.js';

/**
 * Central logger. Every log line must avoid secrets: never pass raw
 * auth-state objects, passwords, tokens, or full env to this logger.
 */
export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  transport: config.isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
});

/**
 * Creates a child logger scoped to one bot, so every log line from that
 * bot's lifecycle is traceable without leaking into other bots' logs.
 */
export function botLogger(botId) {
  return logger.child({ botId });
}
