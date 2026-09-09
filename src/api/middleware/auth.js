import User from '../../db/models/User.js'
import config from '../../config/index.js'
import logger from '../../utils/logger.js'
import crypto from 'crypto'
import { verifyToken } from '../../utils/authToken.js'
import { resolveEffectivePlan, hasFeature } from '../../config/plans.js'

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function attachUser(user) {
  const effective = resolveEffectivePlan(user)
  return {
    userId: user.userId,
    username: user.username,
    role: user.role,
    isAdmin: user.role === 'admin',
    plan: effective.id,
    planExpiresAt: user.planExpiresAt || null,
    maxSessions: user.role === 'admin' ? Math.max(user.maxSessions || 15, 15) : effective.maxSessions,
    features: effective.features || {},
  }
}

/**
 * Authentication – JWT or x-api-key.
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

    if (apiKey && config.security.adminApiKey && safeEqual(apiKey, config.security.adminApiKey)) {
      req.user = {
        userId: 'admin',
        role: 'admin',
        isAdmin: true,
        plan: 'business',
        planExpiresAt: null,
        maxSessions: 99,
        features: { pairing: true, botSettings: true },
      }
      return next()
    }

    if (bearer) {
      const payload = verifyToken(bearer)
      if (payload?.userId) {
        const user = await User.findOne({ userId: payload.userId, isActive: true }).lean()
        if (user) {
          if (!user.emailVerified && user.role !== 'admin') {
            return res.status(403).json({
              error: 'Email belum diverifikasi. Verifikasi email dulu sebelum menggunakan dashboard.',
              code: 'EMAIL_NOT_VERIFIED',
              email: user.email || '',
              requiresVerification: true,
            })
          }
          req.user = attachUser(user)
          return next()
        }
      }
      if (!apiKey) return res.status(401).json({ error: 'Invalid or expired session' })
    }

    if (apiKey) {
      const user = await User.findOne({ apiKey, isActive: true }).lean()
      if (!user) return res.status(401).json({ error: 'Invalid API key' })
      if (!user.emailVerified && user.role !== 'admin') {
        return res.status(403).json({
          error: 'Email belum diverifikasi. Verifikasi email dulu sebelum menggunakan API.',
          code: 'EMAIL_NOT_VERIFIED',
          email: user.email || '',
          requiresVerification: true,
        })
      }
      req.user = attachUser(user)
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

/**
 * Require a plan feature flag (e.g. 'botSettings').
 * Free users get 403 even if they call the API directly.
 */
export function requireFeature(featureKey) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    if (req.user.isAdmin) return next()
    if (req.user.features?.[featureKey]) return next()
    return res.status(403).json({
      error: 'Fitur ini tersedia di paket Pro.',
      code: 'PLAN_REQUIRED',
      feature: featureKey,
      plan: req.user.plan || 'free',
    })
  }
}

export { hasFeature, resolveEffectivePlan }
