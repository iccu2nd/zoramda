import User from '../../db/models/User.js'
import config from '../../config/index.js'
import logger from '../../utils/logger.js'
import { verifyToken } from '../../utils/authToken.js'

/**
 * Authentication – accepts either:
 *   Authorization: Bearer <jwt>   (web dashboard login session)
 *   x-api-key: <apiKey>           (programmatic / bot API access)
 * No admin key required for normal account usage; ADMIN_API_KEY (if set)
 * still works as an operator shortcut for server-side tooling.
 */
export async function authenticate(req, res, next) {
  try {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null
    const apiKey = req.headers['x-api-key'] || null

    if (!bearer && !apiKey) {
      return res.status(401).json({ error: 'Missing credentials' })
    }

    // Admin shortcut (operator tooling only, not used by the web UI)
    if (apiKey && config.security.adminApiKey && apiKey === config.security.adminApiKey) {
      req.user = { userId: 'admin', role: 'admin', isAdmin: true }
      return next()
    }

    // JWT session token (issued at login/register)
    if (bearer) {
      const payload = verifyToken(bearer)
      if (payload?.userId) {
        const user = await User.findOne({ userId: payload.userId, isActive: true }).lean()
        if (user) {
          req.user = {
            userId: user.userId,
            username: user.username,
            role: user.role,
            isAdmin: user.role === 'admin',
            maxSessions: user.maxSessions,
          }
          return next()
        }
      }
      if (!apiKey) return res.status(401).json({ error: 'Invalid or expired session' })
    }

    // API key (programmatic access)
    if (apiKey) {
      const user = await User.findOne({ apiKey, isActive: true }).lean()
      if (!user) return res.status(401).json({ error: 'Invalid API key' })
      req.user = {
        userId: user.userId,
        username: user.username,
        role: user.role,
        isAdmin: user.role === 'admin',
        maxSessions: user.maxSessions,
      }
      return next()
    }

    return res.status(401).json({ error: 'Invalid credentials' })
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
