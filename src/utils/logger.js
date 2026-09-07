import pino from 'pino'
import config from '../config/index.js'

const opts = {
  level: config.logLevel,
  base: { app: 'zorabot' },
  redact: {
    paths: [
      'auth',
      'creds',
      'keys',
      'password',
      'token',
      'apiKey',
      'secret',
      'authorization',
      'mongodb.uri',
      '*.password',
      '*.token',
      '*.secret',
    ],
    remove: true,
  },
}

// pino-pretty is optional – only used in development
if (!config.isProd) {
  try {
    opts.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    }
  } catch {
    // ignore if not installed
  }
}

const logger = pino(opts)
export default logger
