/**
 * ZoraBot – Production-ready multi-session WhatsApp Gateway
 * Entry point
 */
import config from './config/index.js'
import logger from './utils/logger.js'
import { connectMongo, disconnectMongo } from './db/mongo.js'
import SessionManager from './core/SessionManager.js'
import { createServer } from './api/server.js'

const sessionManager = new SessionManager()
let server = null

async function main() {
  logger.info({ env: config.env, port: config.port }, 'Starting ZoraBot')

  // 1. Database first
  await connectMongo()

  // 2. Core engine (plugins + session restore runs in background).
  //    Bot config is per-user now and warms lazily per session — no
  //    global config load needed at boot.
  await sessionManager.init()

  // 3. HTTP API
  const app = createServer(sessionManager)
  server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'API server listening')
  })

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down...')
    try {
      if (server) {
        await new Promise((resolve) => server.close(resolve))
      }
      await sessionManager.shutdown()
      await disconnectMongo()
      logger.info('Shutdown complete')
      process.exit(0)
    } catch (err) {
      logger.error({ err: err.message }, 'Shutdown error')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception')
  })

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled rejection')
  })
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to start')
  process.exit(1)
})
