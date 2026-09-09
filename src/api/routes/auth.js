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
  generateVerificationToken,
  verifyToken,
} from '../../utils/authToken.js'
import { sendVerificationEmail, resolveBaseUrl } from '../../services/resendEmail.js'
import { rateLimit } from '../middleware/rateLimit.js'

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
    emailVerified: !!user.emailVerified,
    phone: user.phone || '',
    role: user.role,
    isAdmin: user.role === 'admin',
    plan: effective.id,
    planExpiresAt: user.planExpiresAt || null,
    maxSessions: user.role === 'admin' ? user.maxSessions ?? 15 : effective.maxSessions,
    features: effective.features || {},
    name: user.name || '',
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
  rateLimit({
    name: 'register',
    windowMs: 60 * 60_000,
    max: 20,
    message: 'Terlalu banyak percobaan daftar dari IP ini. Coba lagi dalam 1 jam.',
  }),
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
      const verificationToken = generateVerificationToken()
      const verificationExpires = new Date(Date.now() + config.email.verifyTtlHours * 3600 * 1000)

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
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpires,
        emailVerificationSentAt: new Date(),
      })

      const emailSent = await sendVerificationEmail({
        to: user.email,
        name: user.name || user.username,
        token: verificationToken,
        baseUrl: resolveBaseUrl(req),
      })

      // Jangan kirim JWT sebelum email diverifikasi.
      res.status(201).json({
        ok: true,
        emailSent,
        email: user.email,
        username: user.username,
        message: emailSent
          ? 'Akun berhasil dibuat. Cek email Gmail kamu untuk tautan verifikasi sebelum masuk.'
          : 'Akun berhasil dibuat. Email verifikasi gagal dikirim — coba kirim ulang dari halaman login.',
        requiresVerification: true,
      })
    } catch (err) {
      if (err.code === 11000) {
        const field = err.keyValue ? Object.keys(err.keyValue)[0] : null
        if (field === 'username') {
          return res.status(409).json({ error: 'Username sudah digunakan.' })
        }
        if (field === 'email') {
          return res.status(409).json({ error: 'Email sudah terdaftar.' })
        }
        logger.error(
          { field, keyValue: err.keyValue },
          'Register duplicate key on unexpected field'
        )
        return res.status(409).json({
          error: field
            ? `Gagal mendaftar: field '${field}' bentrok. Kemungkinan index unik lama di DB — hubungi admin.`
            : 'Gagal mendaftar karena konflik data. Coba lagi.',
        })
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
  rateLimit({
    name: 'login',
    windowMs: 15 * 60_000,
    max: 40,
    message: 'Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.',
  }),
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

      if (!user.emailVerified) {
        return res.status(403).json({
          error: 'Email belum diverifikasi. Cek inbox Gmail kamu dan klik tautan verifikasi.',
          code: 'EMAIL_NOT_VERIFIED',
          email: user.email || '',
          requiresVerification: true,
        })
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
        email: `admin+${userId.slice(0, 8)}@local.invalid`,
        passwordHash,
        apiKey,
        role,
        name: req.body.name || '',
        maxSessions: config.session.maxPerUser,
        emailVerified: true,
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

/**
 * Verify an email address using the token sent by email. Public route —
 * hit directly by the link/button in the verification email.
 */
router.get(
  '/verify-email',
  rateLimit({
    name: 'verify-email',
    windowMs: 15 * 60_000,
    max: 60,
    message: 'Terlalu banyak permintaan verifikasi. Coba lagi sebentar.',
  }),
  async (req, res) => {
  try {
    const token = String(req.query.token || '').trim()
    if (!token) {
      return res.status(400).json({ error: 'Token verifikasi tidak ditemukan.' })
    }

    const user = await User.findOne({ emailVerificationToken: token })
    if (!user) {
      // Might already have been verified & cleared — check by trying to
      // give a friendlier message when possible, otherwise generic invalid.
      return res.status(400).json({ error: 'Tautan verifikasi tidak valid atau sudah digunakan.' })
    }

    if (user.emailVerified) {
      return res.json({ verified: true, alreadyVerified: true, email: user.email })
    }

    if (!user.emailVerificationExpires || user.emailVerificationExpires.getTime() < Date.now()) {
      return res.status(410).json({ error: 'Tautan verifikasi sudah kedaluwarsa.', expired: true, email: user.email })
    }

    user.emailVerified = true
    user.emailVerificationToken = null
    user.emailVerificationExpires = null
    await user.save()

    res.json({ verified: true, alreadyVerified: false, email: user.email })
  } catch (err) {
    logger.error({ err: err.message }, 'Verify email error')
    res.status(500).json({ error: 'Gagal memverifikasi email.' })
  }
})

/**
 * Resend the verification email. Accepts an email in body for the public
 * "expired link" flow, or falls back to the authenticated user.
 */
router.post(
  '/resend-verification',
  rateLimit({
    name: 'resend-verification',
    windowMs: 60 * 60_000,
    max: 12,
    message: 'Terlalu banyak kirim ulang email. Coba lagi nanti.',
  }),
  async (req, res) => {
  try {
    const bodyEmail = normalizeEmail(req.body?.email)
    let user = null

    if (bodyEmail) {
      user = await User.findOne({ email: bodyEmail })
    } else {
      const authHeader = req.headers.authorization || ''
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      if (bearer) {
        const decoded = verifyToken(bearer)
        if (decoded?.userId) user = await User.findOne({ userId: decoded.userId })
      }
    }

    // Always respond with a generic success message to avoid leaking
    // which emails exist in the system.
    const genericOk = { ok: true, message: 'Jika email terdaftar dan belum terverifikasi, tautan verifikasi baru telah dikirim.' }

    if (!user || user.emailVerified) {
      return res.json(genericOk)
    }

    const cooldownMs = config.email.resendCooldownSeconds * 1000
    if (user.emailVerificationSentAt && Date.now() - user.emailVerificationSentAt.getTime() < cooldownMs) {
      const waitSec = Math.ceil(
        (cooldownMs - (Date.now() - user.emailVerificationSentAt.getTime())) / 1000
      )
      return res.status(429).json({ error: `Tunggu ${waitSec} detik sebelum mengirim ulang.` })
    }

    const verificationToken = generateVerificationToken()
    user.emailVerificationToken = verificationToken
    user.emailVerificationExpires = new Date(Date.now() + config.email.verifyTtlHours * 3600 * 1000)
    user.emailVerificationSentAt = new Date()
    await user.save()

    await sendVerificationEmail({
      to: user.email,
      name: user.name || user.username,
      token: verificationToken,
      baseUrl: resolveBaseUrl(req),
    })

    res.json(genericOk)
  } catch (err) {
    logger.error({ err: err.message }, 'Resend verification error')
    res.status(500).json({ error: 'Gagal mengirim ulang email verifikasi.' })
  }
})

export default router
