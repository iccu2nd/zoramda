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
      maxPoolSize: 20,
      minPoolSize: 2,
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

export default { connectMongo, getDb, disconnectMongo }
