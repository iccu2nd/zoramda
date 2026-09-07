import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { validateBody, validateParam } from '../middleware/validate.js'
import logger from '../../utils/logger.js'

/**
 * @param {import('../../core/SessionManager.js').SessionManager} sessionManager
 */
export default function createSessionRoutes(sessionManager) {
  const router = Router()

  router.use(authenticate)

  // List sessions for current user
  router.get('/', async (req, res) => {
    try {
      const sessions = await sessionManager.listSessions(req.user.userId, {
        includeInactive: req.query.all === 'true' && req.user.isAdmin,
      })
      res.json({ sessions })
    } catch (err) {
      logger.error({ err: err.message }, 'List sessions error')
      res.status(500).json({ error: 'Failed to list sessions' })
    }
  })

  // Create session
  router.post(
    '/',
    validateBody({
      name: { type: 'string', maxLength: 64 },
      pairingPhone: { type: 'string', maxLength: 20 },
    }),
    async (req, res) => {
      try {
        const { name, pairingPhone } = req.body || {}
        const info = await sessionManager.createSession(req.user.userId, {
          name,
          pairingPhone,
        })
        res.status(201).json(info)
      } catch (err) {
        if (err.code === 'MAX_SESSIONS') {
          return res.status(429).json({ error: err.message })
        }
        logger.error({ err: err.message }, 'Create session error')
        res.status(500).json({ error: 'Failed to create session' })
      }
    }
  )

  // Session detail / status
  router.get('/:sessionId', validateParam('sessionId'), async (req, res) => {
    try {
      await sessionManager.assertOwnership(req.params.sessionId, req.user.userId, req.user.isAdmin)
      const info = await sessionManager.getSessionInfo(req.params.sessionId)
      if (!info) return res.status(404).json({ error: 'Session not found' })
      // Never expose credentials
      res.json(info)
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      logger.error({ err: err.message }, 'Get session error')
      res.status(500).json({ error: 'Failed to get session' })
    }
  })

  // Get QR
  router.get('/:sessionId/qr', validateParam('sessionId'), async (req, res) => {
    try {
      await sessionManager.assertOwnership(req.params.sessionId, req.user.userId, req.user.isAdmin)
      const data = await sessionManager.getQr(req.params.sessionId)
      if (!data) return res.status(404).json({ error: 'Session not found' })
      res.json(data)
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      res.status(500).json({ error: 'Failed to get QR' })
    }
  })

  // Get pairing code
  router.get('/:sessionId/pairing', validateParam('sessionId'), async (req, res) => {
    try {
      await sessionManager.assertOwnership(req.params.sessionId, req.user.userId, req.user.isAdmin)
      const data = await sessionManager.getPairingCode(req.params.sessionId)
      if (!data) return res.status(404).json({ error: 'Session not found' })
      res.json(data)
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      res.status(500).json({ error: 'Failed to get pairing code' })
    }
  })

  // Connect / start
  router.post(
    '/:sessionId/connect',
    validateParam('sessionId'),
    validateBody({ pairingPhone: { type: 'string', maxLength: 20 } }),
    async (req, res) => {
      try {
        await sessionManager.assertOwnership(req.params.sessionId, req.user.userId, req.user.isAdmin)
        const info = await sessionManager.connect(req.params.sessionId, {
          pairingPhone: req.body?.pairingPhone,
        })
        res.json(info)
      } catch (err) {
        if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
        if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message })
        logger.error({ err: err.message }, 'Connect session error')
        res.status(500).json({ error: 'Failed to connect session' })
      }
    }
  )

  // Disconnect
  router.post('/:sessionId/disconnect', validateParam('sessionId'), async (req, res) => {
    try {
      await sessionManager.assertOwnership(req.params.sessionId, req.user.userId, req.user.isAdmin)
      const logout = req.body?.logout === true
      const info = await sessionManager.disconnect(req.params.sessionId, { logout })
      res.json(info)
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      res.status(500).json({ error: 'Failed to disconnect' })
    }
  })

  // Delete
  router.delete('/:sessionId', validateParam('sessionId'), async (req, res) => {
    try {
      await sessionManager.assertOwnership(req.params.sessionId, req.user.userId, req.user.isAdmin)
      await sessionManager.deleteSession(req.params.sessionId)
      res.json({ deleted: true })
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      res.status(500).json({ error: 'Failed to delete session' })
    }
  })

  return router
}
