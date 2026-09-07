import { Router } from 'express'
import User from '../../db/models/User.js'
import Session from '../../db/models/Session.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { validateBody, validateParam } from '../middleware/validate.js'
import configService from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'
import { hashPassword, isValidPassword } from '../../utils/authToken.js'

function publicUser(u) {
  return {
    userId: u.userId,
    username: u.username,
    role: u.role,
    isAdmin: u.role === 'admin',
    name: u.name || '',
    isActive: u.isActive !== false,
    maxSessions: u.maxSessions,
    createdAt: u.createdAt,
  }
}

/**
 * Superadmin API – full platform control from the website dashboard:
 * every user account and every bot session, not just the caller's own.
 * @param {import('../../core/SessionManager.js').SessionManager} sessionManager
 */
export default function createAdminRoutes(sessionManager) {
  const router = Router()
  router.use(authenticate, requireAdmin)

  function getSocket(sessionId) {
    const cm = sessionManager.getConnection(sessionId)
    const sock = cm?.getSocket?.()
    return sock || null
  }

  /* ——— platform overview ——— */
  router.get('/overview', async (req, res) => {
    try {
      const [userCount, activeUserCount, sessions] = await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ isActive: true }),
        sessionManager.listAllSessions(),
      ])
      const byStatus = {}
      for (const s of sessions) byStatus[s.status] = (byStatus[s.status] || 0) + 1
      const mem = process.memoryUsage()
      res.json({
        users: { total: userCount, active: activeUserCount },
        sessions: { total: sessions.length, byStatus },
        server: {
          uptimeSeconds: Math.floor(process.uptime()),
          memoryMb: +(mem.rss / 1024 / 1024).toFixed(1),
        },
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin overview error')
      res.status(500).json({ error: 'Failed to load overview' })
    }
  })

  /* ——— users (platform accounts) ——— */
  router.get('/users', async (req, res) => {
    try {
      const users = await User.find({}).sort({ createdAt: -1 }).lean()
      const counts = await Session.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ])
      const countMap = new Map(counts.map((c) => [c._id, c.count]))
      res.json({
        users: users.map((u) => ({ ...publicUser(u), sessionCount: countMap.get(u.userId) || 0 })),
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin list users error')
      res.status(500).json({ error: 'Failed to list users' })
    }
  })

  router.patch('/users/:userId', validateParam('userId'), async (req, res) => {
    try {
      const body = req.body || {}
      const patch = {}
      if (body.role === 'admin' || body.role === 'user') patch.role = body.role
      if (typeof body.isActive === 'boolean') patch.isActive = body.isActive
      if (body.maxSessions !== undefined) {
        patch.maxSessions = Math.max(1, parseInt(body.maxSessions, 10) || 1)
      }
      if (typeof body.name === 'string') patch.name = body.name.slice(0, 64)

      if (req.user.userId === req.params.userId && patch.role === 'user') {
        return res.status(400).json({ error: 'Tidak bisa cabut role admin dari akun sendiri' })
      }
      if (req.user.userId === req.params.userId && patch.isActive === false) {
        return res.status(400).json({ error: 'Tidak bisa nonaktifkan akun sendiri' })
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'Tidak ada field yang valid untuk diubah' })
      }

      const user = await User.findOneAndUpdate({ userId: req.params.userId }, patch, { new: true }).lean()
      if (!user) return res.status(404).json({ error: 'User not found' })
      res.json(publicUser(user))
    } catch (err) {
      logger.error({ err: err.message }, 'Admin update user error')
      res.status(500).json({ error: 'Failed to update user' })
    }
  })

  router.post(
    '/users/:userId/reset-password',
    validateParam('userId'),
    validateBody({ password: { type: 'string', required: true, maxLength: 128 } }),
    async (req, res) => {
      try {
        if (!isValidPassword(req.body.password)) {
          return res.status(400).json({ error: 'Password minimal 6 karakter' })
        }
        const passwordHash = await hashPassword(req.body.password)
        const user = await User.findOneAndUpdate(
          { userId: req.params.userId },
          { passwordHash },
          { new: true }
        ).lean()
        if (!user) return res.status(404).json({ error: 'User not found' })
        res.json({ reset: true })
      } catch (err) {
        logger.error({ err: err.message }, 'Admin reset password error')
        res.status(500).json({ error: 'Failed to reset password' })
      }
    }
  )

  // deactivate account + stop/logout all of their sessions
  router.delete('/users/:userId', validateParam('userId'), async (req, res) => {
    try {
      if (req.user.userId === req.params.userId) {
        return res.status(400).json({ error: 'Tidak bisa nonaktifkan akun sendiri' })
      }
      const user = await User.findOneAndUpdate(
        { userId: req.params.userId },
        { isActive: false },
        { new: true }
      ).lean()
      if (!user) return res.status(404).json({ error: 'User not found' })

      const sessions = await Session.find({ userId: req.params.userId, isActive: true }).lean()
      for (const s of sessions) {
        await sessionManager.deleteSession(s.sessionId).catch(() => {})
      }
      res.json({ deactivated: true, sessionsStopped: sessions.length })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin deactivate user error')
      res.status(500).json({ error: 'Failed to deactivate user' })
    }
  })

  // WA-level bans (numbers blocked from a user's bot)
  router.get('/users/:userId/banned', validateParam('userId'), async (req, res) => {
    try {
      await configService.warm(req.params.userId)
      res.json({ banned: configService.getBannedUsers(req.params.userId) })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin get banned error')
      res.status(500).json({ error: 'Failed to load banned users' })
    }
  })

  router.post(
    '/users/:userId/banned',
    validateParam('userId'),
    validateBody({ number: { type: 'string', required: true, maxLength: 20 } }),
    async (req, res) => {
      try {
        const digits = String(req.body.number).replace(/\D/g, '')
        if (!digits) return res.status(400).json({ error: 'Nomor tidak valid' })
        const banned = await configService.banUser(req.params.userId, `${digits}@s.whatsapp.net`)
        res.json({ banned })
      } catch (err) {
        logger.error({ err: err.message }, 'Admin ban user error')
        res.status(500).json({ error: 'Failed to ban number' })
      }
    }
  )

  router.delete('/users/:userId/banned/:jid', async (req, res) => {
    try {
      const banned = await configService.unbanUser(req.params.userId, decodeURIComponent(req.params.jid))
      res.json({ banned })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin unban user error')
      res.status(500).json({ error: 'Failed to unban number' })
    }
  })

  /* ——— sessions / bots (every user, not just the caller's own) ——— */
  router.get('/sessions', async (req, res) => {
    try {
      const sessions = await sessionManager.listAllSessions()
      const userIds = [...new Set(sessions.map((s) => s.userId))]
      const users = await User.find({ userId: { $in: userIds } }).lean()
      const nameMap = new Map(users.map((u) => [u.userId, u.username]))
      res.json({
        sessions: sessions.map((s) => ({ ...s, ownerUsername: nameMap.get(s.userId) || s.userId })),
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin list sessions error')
      res.status(500).json({ error: 'Failed to list sessions' })
    }
  })

  // groups the session's WA number currently participates in
  router.get('/sessions/:sessionId/groups', validateParam('sessionId'), async (req, res) => {
    try {
      const sock = getSocket(req.params.sessionId)
      if (!sock) return res.status(409).json({ error: 'Session tidak terhubung' })
      const groups = await sock.groupFetchAllParticipating()
      res.json({
        groups: Object.values(groups || {}).map((g) => ({
          id: g.id,
          subject: g.subject,
          participants: (g.participants || []).length,
        })),
      })
    } catch (err) {
      res.status(500).json({ error: `Gagal ambil daftar grup: ${err.message}` })
    }
  })

  // broadcast a message to every group of a session (fire-and-forget, rate limited)
  router.post(
    '/sessions/:sessionId/broadcast',
    validateParam('sessionId'),
    validateBody({ message: { type: 'string', required: true, maxLength: 4000 } }),
    async (req, res) => {
      try {
        const sock = getSocket(req.params.sessionId)
        if (!sock) return res.status(409).json({ error: 'Session tidak terhubung' })
        const groups = await sock.groupFetchAllParticipating()
        const groupIds = Object.keys(groups || {})
        if (groupIds.length === 0) return res.status(400).json({ error: 'Bot belum join grup manapun' })

        res.json({ started: true, groupCount: groupIds.length })

        ;(async () => {
          for (const gid of groupIds) {
            try {
              await sock.sendMessage(gid, { text: `📢 *Broadcast Admin*\n\n${req.body.message}` })
            } catch (err) {
              logger.warn({ sessionId: req.params.sessionId, gid, err: err.message }, 'Admin broadcast send failed')
            }
            await new Promise((r) => setTimeout(r, 1500))
          }
        })()
      } catch (err) {
        res.status(500).json({ error: `Gagal broadcast: ${err.message}` })
      }
    }
  )

  // group settings: open / close / rename / description
  router.post('/sessions/:sessionId/groups/:groupId/settings', validateParam('sessionId'), async (req, res) => {
    try {
      const sock = getSocket(req.params.sessionId)
      if (!sock) return res.status(409).json({ error: 'Session tidak terhubung' })
      const gid = decodeURIComponent(req.params.groupId)
      const { action, value } = req.body || {}
      if (action === 'open') await sock.groupSettingUpdate(gid, 'not_announcement')
      else if (action === 'close') await sock.groupSettingUpdate(gid, 'announcement')
      else if (action === 'name') await sock.groupUpdateSubject(gid, String(value || '').slice(0, 100))
      else if (action === 'desc') await sock.groupUpdateDescription(gid, String(value || '').slice(0, 512))
      else return res.status(400).json({ error: 'Aksi tidak dikenal' })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: `Gagal: ${err.message}` })
    }
  })

  // group members: kick / promote / demote
  router.post('/sessions/:sessionId/groups/:groupId/members', validateParam('sessionId'), async (req, res) => {
    try {
      const sock = getSocket(req.params.sessionId)
      if (!sock) return res.status(409).json({ error: 'Session tidak terhubung' })
      const gid = decodeURIComponent(req.params.groupId)
      const { action, number } = req.body || {}
      const methodMap = { kick: 'remove', promote: 'promote', demote: 'demote' }
      const method = methodMap[action]
      if (!method) return res.status(400).json({ error: 'Aksi tidak dikenal' })
      const digits = String(number || '').replace(/\D/g, '')
      if (!digits) return res.status(400).json({ error: 'Nomor tidak valid' })
      await sock.groupParticipantsUpdate(gid, [`${digits}@s.whatsapp.net`], method)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: `Gagal: ${err.message}` })
    }
  })

  // tagall / hidetag
  router.post('/sessions/:sessionId/groups/:groupId/tag', validateParam('sessionId'), async (req, res) => {
    try {
      const sock = getSocket(req.params.sessionId)
      if (!sock) return res.status(409).json({ error: 'Session tidak terhubung' })
      const gid = decodeURIComponent(req.params.groupId)
      const { message, hide } = req.body || {}
      const metadata = await sock.groupMetadata(gid)
      const participants = (metadata.participants || []).map((p) => p.id)
      if (participants.length === 0) return res.status(400).json({ error: 'Grup tidak punya member' })

      let text
      if (hide) {
        text = message || ''
      } else {
        const list = participants.map((jid, i) => `${i + 1}. @${jid.split('@')[0]}`).join('\n')
        text = `${message ? `${message}\n\n` : ''}${list}`
      }
      await sock.sendMessage(gid, { text, mentions: participants })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: `Gagal: ${err.message}` })
    }
  })

  return router
}
