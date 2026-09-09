import mongoose from 'mongoose'
import config from '../config/index.js'
import logger from '../utils/logger.js'

let isConnecting = false
let connectionPromise = null

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection
  }

  if (isConnecting && connectionPromise) {
    return connectionPromise
  }

  isConnecting = true
  connectionPromise = mongoose
    .connect(config.mongo.uri, {
      dbName: config.mongo.dbName,
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      retryWrites: true,
      retryReads: true,
    })
    .then((conn) => {
      logger.info('MongoDB connected')
      isConnecting = false
      return conn.connection
    })
    .catch((err) => {
      isConnecting = false
      connectionPromise = null
      logger.error({ err: err.message }, 'MongoDB connection failed')
      throw err
    })

  return connectionPromise
}

/**
 * Reconciles each model's indexes with what's actually in MongoDB — drops
 * any index that's no longer declared in the schema (e.g. leftover unique
 * indexes from an older schema version, like a removed `usernameLower`
 * field) and creates any that are missing. Runs once at boot; failures are
 * logged but never crash startup, since the app can still run on existing
 * indexes even if a sync attempt fails (e.g. insufficient Atlas permissions).
 */
export async function syncModelIndexes() {
  const models = [
    (await import('./models/User.js')).default,
    (await import('./models/Session.js')).default,
    (await import('./models/SessionConfig.js')).default,
    (await import('./models/Payment.js')).default,
    (await import('./models/BotConfig.js')).default,
    (await import('./models/AuthState.js')).default,
  ]

  for (const model of models) {
    try {
      const dropped = await model.syncIndexes()
      if (dropped.length) {
        logger.info({ model: model.modelName, dropped }, 'Dropped stale indexes')
      }
    } catch (err) {
      logger.warn(
        { model: model.modelName, err: err.message },
        'Index sync failed for model — continuing with existing indexes'
      )
    }
  }
}

export function getDb() {
  return mongoose.connection
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
    logger.info('MongoDB disconnected')
  }
}

// Graceful handling of connection events
mongoose.connection.on('error', (err) => {
  logger.error({ err: err.message }, 'MongoDB error')
})

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected')
})

export default { connectMongo, getDb, disconnectMongo, syncModelIndexes }
