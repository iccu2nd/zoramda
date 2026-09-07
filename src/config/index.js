import 'dotenv/config'

/**
 * Static / infrastructure config from environment only.
 * Bot behavior settings (prefix, owner, name, etc.) live in ConfigService + MongoDB.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/botenv',
    dbName: process.env.MONGODB_DB_NAME || 'botenv',
  },

  security: {
    apiSecret: process.env.API_SECRET || 'dev-secret-change-me',
    jwtSecret: process.env.JWT_SECRET || 'dev-jwt-change-me',
    adminApiKey: process.env.ADMIN_API_KEY || 'dev-admin-key',
  },

  logLevel: process.env.LOG_LEVEL || 'info',
  latencyThreshold: parseInt(process.env.LATENCY_LOG_THRESHOLD_MS || '500', 10),

  // Session infrastructure limits (not bot UX)
  session: {
    maxPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '5', 10),
    reconnectMaxRetries: parseInt(process.env.SESSION_RECONNECT_MAX_RETRIES || '10', 10),
    reconnectBaseDelay: parseInt(process.env.SESSION_RECONNECT_BASE_DELAY_MS || '2000', 10),
    reconnectMaxDelay: parseInt(process.env.SESSION_RECONNECT_MAX_DELAY_MS || '60000', 10),
  },
}

export default config
