import { Router } from 'express'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import User from '../../db/models/User.js'
import Session from '../../db/models/Session.js'
import SessionConfig from '../../db/models/SessionConfig.js'
import logger from '../../utils/logger.js'
import { STATES } from '../../core/ConnectionManager.js'

/**
 * Admin panel API — only for role=admin.
 * @param {import('../../core/SessionManager.js').SessionManager} sessionManager
 */
export default function createAdminRoutes(sessionManager) {
  const router = Router()
  router.use(authenticate, requireAdmin)

  /** Overview stats */
  router.get('/stats', async (req, res) => {
    try {
      const [
        usersTotal,
        usersActive,
        sessionsTotal,
        sessionsActive,
        sessionsConnected,
      ] = await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ isActive: true }),
        Session.countDocuments({ isActive: true }),
        Session.countDocuments({ isActive: true, status: { $ne: STATES.STOPPED } }),
        Session.countDocuments({ isActive: true, status: STATES.CONNECTED }),
      ])

      const liveConnected = [...sessionManager.sessions.values()].filter(
        (cm) => cm.status === STATES.CONNECTED
      ).length

      res.json({
        users: { total: usersTotal, active: usersActive },
        sessions: {
          total: sessionsTotal,
          active: sessionsActive,
          connectedDb: sessionsConnected,
          connectedLive: liveConnected,
        },
        plugins: sessionManager.pluginLoader.getAllPlugins().length,
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin stats error')
      res.status(500).json({ error: 'Failed to load stats' })
    }
  })

  /** List users */
  router.get('/users', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
      const q = String(req.query.q || '').trim()
      const filter = {}
      if (q) {
        filter.$or = [
          { username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { userId: q },
        ]
      }

      const [users, total] = await Promise.all([
        User.find(filter)
          .select('-passwordHash -apiKey')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        User.countDocuments(filter),
      ])

      // attach session counts
      const ids = users.map((u) => u.userId)
      const sessionCounts = await Session.aggregate([
        { $match: { userId: { $in: ids }, isActive: true } },
        {
          $group: {
            _id: '$userId',
            total: { $sum: 1 },
            connected: {
              $sum: { $cond: [{ $eq: ['$status', STATES.CONNECTED] }, 1, 0] },
            },
          },
        },
      ])
      const countMap = Object.fromEntries(sessionCounts.map((s) => [s._id, s]))

      res.json({
        users: users.map((u) => ({
          ...u,
          sessions: countMap[u.userId] || { total: 0, connected: 0 },
        })),
        page,
        limit,
        total,
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin list users error')
      res.status(500).json({ error: 'Failed to list users' })
    }
  })

  /** Patch user */
  router.patch('/users/:userId', async (req, res) => {
    try {
      const { userId } = req.params
      if (userId === req.user.userId) {
        // allow some self-edits but not demoting self
      }
      const body = req.body || {}
      const update = {}
      if (typeof body.isActive === 'boolean') update.isActive = body.isActive
      if (body.role === 'admin' || body.role === 'user') update.role = body.role
      if (body.maxSessions !== undefined) {
        update.maxSessions = Math.max(0, parseInt(body.maxSessions, 10) || 0)
      }
      if (body.name !== undefined) update.name = String(body.name).slice(0, 64)

      if (userId === req.user.userId && update.role === 'user') {
        return res.status(400).json({ error: 'Tidak bisa demote diri sendiri' })
      }
      if (userId === req.user.userId && update.isActive === false) {
        return res.status(400).json({ error: 'Tidak bisa nonaktifkan diri sendiri' })
      }

      if (!Object.keys(update).length) {
        return res.status(400).json({ error: 'No valid fields' })
      }

      const user = await User.findOneAndUpdate({ userId }, { $set: update }, { new: true })
        .select('-passwordHash -apiKey')
        .lean()
      if (!user) return res.status(404).json({ error: 'User not found' })
      res.json({ user })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin patch user error')
      res.status(500).json({ error: 'Failed to update user' })
    }
  })

  /** List all sessions */
  router.get('/sessions', async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : null
      const filter = { isActive: true }
      if (status) filter.status = status

      const sessions = await Session.find(filter).sort({ updatedAt: -1 }).limit(200).lean()
      const userIds = [...new Set(sessions.map((s) => s.userId))]
      const users = await User.find({ userId: { $in: userIds } })
        .select('userId username name role')
        .lean()
      const userMap = Object.fromEntries(users.map((u) => [u.userId, u]))

      res.json({
        sessions: sessions.map((s) => {
          const live = sessionManager.sessions.get(s.sessionId)
          return {
            sessionId: s.sessionId,
            name: s.name,
            userId: s.userId,
            user: userMap[s.userId] || null,
            status: live ? live.status : s.status,
            phoneNumber: live?.phoneNumber || s.phoneNumber,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          }
        }),
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin list sessions error')
      res.status(500).json({ error: 'Failed to list sessions' })
    }
  })

  /** Force disconnect / delete session */
  router.post('/sessions/:sessionId/disconnect', async (req, res) => {
    try {
      const { sessionId } = req.params
      const logout = req.body?.logout === true
      await sessionManager.disconnect(sessionId, { logout })
      res.json({ sessionId, status: 'STOPPED' })
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to disconnect' })
    }
  })

  router.delete('/sessions/:sessionId', async (req, res) => {
    try {
      await sessionManager.deleteSession(req.params.sessionId)
      res.json({ deleted: true })
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to delete' })
    }
  })

  return router
}
