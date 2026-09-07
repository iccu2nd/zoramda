import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import User from '../../db/models/User.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import config from '../../config/index.js'
import logger from '../../utils/logger.js'

const router = Router()

/**
 * Create a new user (admin only)
 * Returns apiKey once – store it securely.
 */
router.post(
  '/users',
  authenticate,
  requireAdmin,
  validateBody({
    name: { type: 'string', maxLength: 64 },
    role: { type: 'string' },
  }),
  async (req, res) => {
    try {
      const userId = uuidv4()
      const apiKey = `zb_${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').slice(0, 16)}`
      const role = req.body.role === 'admin' ? 'admin' : 'user'

      await User.create({
        userId,
        apiKey,
        role,
        name: req.body.name || '',
        maxSessions: config.session.maxPerUser,
      })

      res.status(201).json({
        userId,
        apiKey, // only returned on creation
        role,
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Create user error')
      res.status(500).json({ error: 'Failed to create user' })
    }
  }
)

/**
 * Current user info
 */
router.get('/me', authenticate, async (req, res) => {
  res.json({
    userId: req.user.userId,
    role: req.user.role,
    isAdmin: req.user.isAdmin,
  })
})

export default router
