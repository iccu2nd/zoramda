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
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        filter.$or = [
          { username: new RegExp(esc, 'i') },
          { name: new RegExp(esc, 'i') },
          { email: new RegExp(esc, 'i') },
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
      if (body.plan === 'free' || body.plan === 'pro' || body.plan === 'business') {
        update.plan = body.plan
        if (body.plan === 'free') {
          update.planExpiresAt = null
        } else if (body.planExpiresAt) {
          update.planExpiresAt = new Date(body.planExpiresAt)
        } else if (body.plan !== 'free') {
          // default 30 days from now when upgrading
          update.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
      if (body.planExpiresAt !== undefined && body.plan === undefined) {
        update.planExpiresAt = body.planExpiresAt ? new Date(body.planExpiresAt) : null
      }

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

  /** Delete user account */
  router.delete('/users/:userId', async (req, res) => {
    try {
      const { userId } = req.params
      if (userId === req.user.userId) {
        return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' })
      }
      const user = await User.findOne({ userId }).lean()
      if (!user) return res.status(404).json({ error: 'User not found' })
      if (user.role === 'admin') {
        return res.status(400).json({ error: 'Tidak bisa menghapus akun admin lain' })
      }

      // stop & delete sessions belonging to user
      const sessions = await Session.find({ userId, isActive: true }).lean()
      for (const s of sessions) {
        try {
          await sessionManager.deleteSession(s.sessionId)
        } catch (_) {}
      }
      await Session.deleteMany({ userId })
      await SessionConfig.deleteMany({ userId })
      await User.deleteOne({ userId })

      logger.info({ userId, by: req.user.userId }, 'Admin deleted user')
      res.json({ deleted: true, userId })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin delete user error')
      res.status(500).json({ error: 'Failed to delete user' })
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

  // ─── Plugin source editor (admin only) ─────────────────────────────────

  /** List all plugin files + load status */
  router.get('/plugins', async (req, res) => {
    try {
      const plugins = await sessionManager.pluginLoader.listSources()
      res.json({
        plugins,
        folders: sessionManager.pluginLoader.getFolders(),
        count: plugins.length,
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin list plugins error')
      res.status(500).json({ error: 'Failed to list plugins' })
    }
  })

  /** Get starter template source */
  router.get('/plugins/template', async (req, res) => {
    try {
      const { getPluginTemplate } = await import('../../core/PluginLoader.js')
      const folder = String(req.query.folder || 'tools')
      const name = String(req.query.name || 'hello')
      const command = String(req.query.command || name)
      const source = getPluginTemplate({ folder, name, command })
      res.json({
        source,
        suggestedFile: `${folder}/${name.replace(/[^a-zA-Z0-9_-]/g, '') || 'hello'}.js`,
        folders: sessionManager.pluginLoader.getFolders(),
      })
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to build template' })
    }
  })

  /** Read plugin source */
  router.get('/plugins/source', async (req, res) => {
    try {
      const file = String(req.query.file || '')
      if (!file) return res.status(400).json({ error: 'Query ?file=folder/name.js wajib' })
      const data = await sessionManager.pluginLoader.readSource(file)
      res.json(data)
    } catch (err) {
      const status =
        err.code === 'INVALID_PATH' ? 400 : err.code === 'ENOENT' || err.code === 'NOT_FOUND' ? 404 : 500
      res.status(status).json({ error: err.message || 'Failed to read source' })
    }
  })

  /** Create / update plugin source then hot-reload */
  router.put('/plugins/source', async (req, res) => {
    try {
      const file = String(req.body?.file || '')
      const source = req.body?.source
      if (!file) return res.status(400).json({ error: 'Body.file wajib (contoh: tools/hello.js)' })
      if (typeof source !== 'string') return res.status(400).json({ error: 'Body.source (string) wajib' })
      const result = await sessionManager.pluginLoader.writeSource(file, source)
      logger.info(
        { file: result.file, created: result.created, by: req.user?.userId },
        'Admin saved plugin source'
      )
      res.json(result)
    } catch (err) {
      const status =
        err.code === 'INVALID_PATH' ||
        err.code === 'EMPTY_SOURCE' ||
        err.code === 'INVALID_SOURCE' ||
        err.code === 'SOURCE_TOO_LARGE' ||
        err.code === 'LOAD_FAILED'
          ? 400
          : 500
      logger.error({ err: err.message, code: err.code }, 'Admin save plugin error')
      res.status(status).json({ error: err.message || 'Failed to save plugin' })
    }
  })

  /** Delete plugin file + reload */
  router.delete('/plugins/source', async (req, res) => {
    try {
      const file = String(req.body?.file || req.query.file || '')
      if (!file) return res.status(400).json({ error: 'file wajib' })
      const result = await sessionManager.pluginLoader.deleteSource(file)
      logger.info({ file: result.file, by: req.user?.userId }, 'Admin deleted plugin')
      res.json(result)
    } catch (err) {
      const status =
        err.code === 'INVALID_PATH' ? 400 : err.code === 'NOT_FOUND' ? 404 : 500
      res.status(status).json({ error: err.message || 'Failed to delete plugin' })
    }
  })

  /** Force reload all plugins from disk */
  router.post('/plugins/reload', async (req, res) => {
    try {
      const result = await sessionManager.pluginLoader.reloadNow()
      res.json({ ok: true, ...result })
    } catch (err) {
      res.status(500).json({ error: err.message || 'Reload failed' })
    }
  })

  return router
}
