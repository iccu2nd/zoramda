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
    /** Comma-separated emails allowed to see / use admin panel. Empty = role:admin only. */
    adminEmails: String(process.env.ADMIN_EMAILS || '')
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },

  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM_EMAIL || 'Botenv <noreply@botenv.my.id>',
    // Optional manual override. When empty, the app auto-detects the domain
    // from each incoming request (protocol + host) instead.
    appUrlOverride: (process.env.APP_URL || '').replace(/\/+$/, ''),
    verifyTtlHours: parseInt(process.env.EMAIL_VERIFY_TTL_HOURS || '24', 10),
    resendCooldownSeconds: parseInt(process.env.EMAIL_RESEND_COOLDOWN_SECONDS || '60', 10),
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

// --- fail-fast: never allow known dev-default secrets in production ---
if (config.isProd) {
  const insecure = []
  if (config.security.jwtSecret === 'dev-jwt-change-me') insecure.push('JWT_SECRET')
  if (config.security.apiSecret === 'dev-secret-change-me') insecure.push('API_SECRET')
  if (config.security.adminApiKey === 'dev-admin-key') insecure.push('ADMIN_API_KEY')
  if (insecure.length) {
    // logger isn't safe to import here (would create a circular import),
    // so this uses console directly — it only ever fires on misconfiguration.
    console.error(
      `[FATAL] Refusing to start in production with default value(s) for: ${insecure.join(', ')}. ` +
        'Set these to strong random values in your environment before deploying.'
    )
    process.exit(1)
  }
}
