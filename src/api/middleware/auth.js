import User from '../../db/models/User.js'
import config from '../../config/index.js'
import logger from '../../utils/logger.js'

/**
 * Simple API key authentication.
 * Header: x-api-key: <key>
 * or Authorization: Bearer <key>
 */
export async function authenticate(req, res, next) {
  try {
    const key =
      req.headers['x-api-key'] ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null)

    if (!key) {
      return res.status(401).json({ error: 'Missing API key' })
    }

    // Admin shortcut
    if (key === config.security.adminApiKey) {
      req.user = { userId: 'admin', role: 'admin', isAdmin: true }
      return next()
    }

    const user = await User.findOne({ apiKey: key, isActive: true }).lean()
    if (!user) {
      return res.status(401).json({ error: 'Invalid API key' })
    }

    req.user = {
      userId: user.userId,
      role: user.role,
      isAdmin: user.role === 'admin',
      maxSessions: user.maxSessions,
    }
    next()
  } catch (err) {
    logger.error({ err: err.message }, 'Auth middleware error')
    res.status(500).json({ error: 'Authentication failed' })
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
