import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import configService, { EDITABLE_FIELDS } from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'

/**
 * Session-scoped Config API.
 * All settings belong to a specific sessionId.
 * Session A settings never affect Session B.
 */
export default function createConfigRoutes(sessionManager) {
  const router = Router()

  router.use(authenticate)

  async function assertSession(req, sessionId) {
    await sessionManager.assertOwnership(sessionId, req.user.userId, req.user.isAdmin)
  }

  // GET /api/config/:sessionId
  router.get('/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params
      await assertSession(req, sessionId)
      const cfg = await configService.getConfig(sessionId, req.user.userId)
      res.json({ config: cfg, sessionId })
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      logger.error({ err: err.message }, 'Get session config error')
      res.status(500).json({ error: 'Failed to get config' })
    }
  })

  // PUT / PATCH /api/config/:sessionId
  async function updateHandler(req, res) {
    try {
      const { sessionId } = req.params
      await assertSession(req, sessionId)
      const body = req.body || {}
      const partial = {}
      for (const key of EDITABLE_FIELDS) {
        if (body[key] !== undefined) partial[key] = body[key]
      }
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update', allowed: EDITABLE_FIELDS })
      }
      const updated = await configService.update(sessionId, req.user.userId, partial)
      res.json({ config: updated, sessionId })
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      logger.error({ err: err.message }, 'Update session config error')
      res.status(500).json({ error: 'Failed to update config' })
    }
  }

  router.put('/:sessionId', updateHandler)
  router.patch('/:sessionId', updateHandler)

  router.post('/:sessionId/refresh', async (req, res) => {
    try {
      const { sessionId } = req.params
      await assertSession(req, sessionId)
      const cfg = await configService.refresh(sessionId, req.user.userId)
      res.json({ config: cfg, sessionId })
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      res.status(500).json({ error: 'Failed to refresh config' })
    }
  })

  // Field schema for frontend form builder
  router.get('/schema/fields', (req, res) => {
    res.json({
      fields: [
        { key: 'botName', type: 'string', label: 'Nama Bot', maxLength: 64 },
        { key: 'botNumber', type: 'string', label: 'Nomor Bot (display)', maxLength: 20 },
        { key: 'ownerName', type: 'string', label: 'Nama Owner', maxLength: 64 },
        {
          key: 'ownerNumbers',
          type: 'array',
          label: 'Nomor Owner',
          itemType: 'string',
          hint: 'Array atau string dipisah koma',
        },
        { key: 'prefix', type: 'string', label: 'Prefix Command', maxLength: 5 },
        { key: 'publicMode', type: 'boolean', label: 'Mode Publik (semua user bisa pakai)' },
        { key: 'antiSpam', type: 'boolean', label: 'Anti Spam' },
        { key: 'antiSpamCooldownMs', type: 'number', label: 'Cooldown Anti Spam (ms)' },
        { key: 'readMessages', type: 'boolean', label: 'Read Message (centang biru)' },
        { key: 'sendTyping', type: 'boolean', label: 'Kirim Typing Indicator' },
        { key: 'sendRecording', type: 'boolean', label: 'Kirim Recording Indicator' },
        { key: 'menuTitle', type: 'string', label: 'Judul Menu' },
        {
          key: 'welcomeMessage',
          type: 'string',
          label: 'Pesan Welcome',
          hint: 'Gunakan {prefix} untuk prefix',
        },
        { key: 'ownerOnlyMessage', type: 'string', label: 'Pesan Owner Only' },
        { key: 'maintenanceMode', type: 'boolean', label: 'Mode Maintenance' },
        { key: 'maintenanceMessage', type: 'string', label: 'Pesan Maintenance' },
        { key: 'extra', type: 'object', label: 'Extra (custom JSON)' },
      ],
    })
  })

  return router
}
