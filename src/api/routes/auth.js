import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import User from '../../db/models/User.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import config from '../../config/index.js'
import { resolveEffectivePlan } from '../../config/plans.js'
import logger from '../../utils/logger.js'
import {
  hashPassword,
  verifyPassword,
  signToken,
  normalizeUsername,
  isValidUsername,
  isValidPassword,
} from '../../utils/authToken.js'

const router = Router()

function generateApiKey() {
  return `zb_${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').slice(0, 16)}`
}

function publicUser(user) {
  const effective = resolveEffectivePlan(user)
  return {
    userId: user.userId,
    username: user.username,
    email: user.email || '',
    phone: user.phone || '',
    role: user.role,
    isAdmin: user.role === 'admin',
    plan: effective.id,
    planExpiresAt: user.planExpiresAt || null,
    maxSessions: user.role === 'admin' ? user.maxSessions ?? 15 : effective.maxSessions,
    features: effective.features || {},
    name: user.name || '',
    apiKey: user.apiKey,
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function isValidEmail(email) {
  return /^[^\s@]+@gmail\.com$/.test(email) && email.length <= 120
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}


/**
 * Self-service registration – anyone can create their own account.
 * No admin key required. Each user gets their own apiKey and config.
 */
router.post(
  '/register',
  validateBody({
    username: { type: 'string', required: true, maxLength: 32 },
    email: { type: 'string', required: true, maxLength: 120 },
    password: { type: 'string', required: true, maxLength: 128 },
    confirmPassword: { type: 'string', maxLength: 128 },
    phone: { type: 'string', maxLength: 20 },
    name: { type: 'string', maxLength: 64 },
  }),
  async (req, res) => {
    try {
      const username = normalizeUsername(req.body.username)
      const email = normalizeEmail(req.body.email)
      const password = String(req.body.password || '')
      const confirmPassword = String(req.body.confirmPassword ?? req.body.passwordConfirm ?? '')
      const phone = normalizePhone(req.body.phone)

      if (!isValidUsername(username)) {
        return res.status(400).json({
          error: 'Username 3–32 karakter (huruf kecil, angka, underscore, titik).',
        })
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Email harus menggunakan alamat @gmail.com.' })
      }
      if (!isValidPassword(password)) {
        return res.status(400).json({ error: 'Password minimal 6 karakter.' })
      }
      if (confirmPassword && password !== confirmPassword) {
        return res.status(400).json({ error: 'Konfirmasi password tidak cocok.' })
      }
      if (phone && (phone.length < 8 || phone.length > 16)) {
        return res.status(400).json({ error: 'Masukkan nomor WhatsApp yang valid.' })
      }

      const existing = await User.findOne({
        $or: [{ username }, { email }],
      }).lean()
      if (existing) {
        if (existing.username === username) {
          return res.status(409).json({ error: 'Username sudah digunakan.' })
        }
        return res.status(409).json({ error: 'Email sudah terdaftar.' })
      }

      const userId = uuidv4()
      const passwordHash = await hashPassword(password)
      const apiKey = generateApiKey()

      const user = await User.create({
        userId,
        username,
        email,
        phone: phone || '',
        passwordHash,
        apiKey,
        role: 'user',
        plan: 'free',
        name: req.body.name || '',
        maxSessions: 1,
      })

      const token = signToken(user)
      res.status(201).json({ token, user: publicUser(user) })
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Username atau email sudah terdaftar.' })
      }
      logger.error({ err: err.message }, 'Register error')
      res.status(500).json({ error: 'Pendaftaran gagal.' })
    }
  }
)

/**
 * Login with username or email + password. Returns a session token — no
 * apiKey needed to use the dashboard.
 */
router.post(
  '/login',
  validateBody({
    username: { type: 'string', required: true, maxLength: 120 },
    password: { type: 'string', required: true, maxLength: 128 },
  }),
  async (req, res) => {
    try {
      const raw = String(req.body.username || '').trim()
      const isEmail = raw.includes('@')
      const password = String(req.body.password || '')

      const query = isEmail
        ? { email: normalizeEmail(raw), isActive: true }
        : { username: normalizeUsername(raw), isActive: true }

      const user = await User.findOne(query)
      if (!user) {
        return res.status(401).json({ error: 'Username/email atau password salah' })
      }

      const ok = await verifyPassword(password, user.passwordHash)
      if (!ok) {
        return res.status(401).json({ error: 'Username/email atau password salah' })
      }

      const token = signToken(user)
      res.json({ token, user: publicUser(user) })
    } catch (err) {
      logger.error({ err: err.message }, 'Login error')
      res.status(500).json({ error: 'Failed to login' })
    }
  }
)

/**
 * Create a new user (admin only) — kept for operator tooling; normal
 * users should use /register instead.
 */
router.post(
  '/users',
  authenticate,
  requireAdmin,
  validateBody({
    username: { type: 'string', required: true, maxLength: 32 },
    password: { type: 'string', required: true, maxLength: 128 },
    name: { type: 'string', maxLength: 64 },
    role: { type: 'string' },
  }),
  async (req, res) => {
    try {
      const username = normalizeUsername(req.body.username)
      if (!isValidUsername(username) || !isValidPassword(req.body.password)) {
        return res.status(400).json({ error: 'Username/password tidak valid' })
      }
      const userId = uuidv4()
      const passwordHash = await hashPassword(req.body.password)
      const apiKey = generateApiKey()
      const role = req.body.role === 'admin' ? 'admin' : 'user'

      const user = await User.create({
        userId,
        username,
        passwordHash,
        apiKey,
        role,
        name: req.body.name || '',
        maxSessions: config.session.maxPerUser,
      })

      res.status(201).json(publicUser(user))
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Username sudah dipakai' })
      }
      logger.error({ err: err.message }, 'Create user error')
      res.status(500).json({ error: 'Failed to create user' })
    }
  }
)

/**
 * Current user info (includes own apiKey for programmatic access)
 */
router.get('/me', authenticate, async (req, res) => {
  if (req.user.userId === 'admin') {
    return res.json({ userId: 'admin', role: 'admin', isAdmin: true })
  }
  const user = await User.findOne({ userId: req.user.userId }).lean()
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(publicUser(user))
})

/**
 * Regenerate own API key (old key stops working immediately).
 */
router.post('/apikey/rotate', authenticate, async (req, res) => {
  if (req.user.userId === 'admin') {
    return res.status(400).json({ error: 'Not applicable for admin shortcut' })
  }
  try {
    const apiKey = generateApiKey()
    const user = await User.findOneAndUpdate(
      { userId: req.user.userId },
      { apiKey },
      { new: true }
    ).lean()
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ apiKey: user.apiKey })
  } catch (err) {
    logger.error({ err: err.message }, 'Rotate apiKey error')
    res.status(500).json({ error: 'Failed to rotate API key' })
  }
})

export default router
