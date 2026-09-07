import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import configService, { EDITABLE_FIELDS } from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'

/**
 * Config API – each user views & edits their own bot settings.
 * No admin key required. Admins may pass ?userId=<id> to inspect another
 * account's config for support purposes.
 */
export default function createConfigRoutes() {
  const router = Router()

  function targetUserId(req) {
    if (req.user.isAdmin && req.query.userId) return String(req.query.userId)
    return req.user.userId
  }

  router.get('/', authenticate, async (req, res) => {
    try {
      const uid = targetUserId(req)
      const cfg = await configService.getConfig(uid)
      res.json({ config: cfg })
    } catch (err) {
      logger.error({ err: err.message }, 'Get config error')
      res.status(500).json({ error: 'Failed to get config' })
    }
  })

  router.put('/', authenticate, async (req, res) => {
    try {
      const uid = targetUserId(req)
      const body = req.body || {}
      const partial = {}
      for (const key of EDITABLE_FIELDS) {
        if (body[key] !== undefined) partial[key] = body[key]
      }
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update', allowed: EDITABLE_FIELDS })
      }
      const updated = await configService.update(uid, partial)
      res.json({ config: updated })
    } catch (err) {
      logger.error({ err: err.message }, 'Update config error')
      res.status(500).json({ error: 'Failed to update config' })
    }
  })

  router.patch('/', authenticate, async (req, res) => {
    try {
      const uid = targetUserId(req)
      const body = req.body || {}
      const partial = {}
      for (const key of EDITABLE_FIELDS) {
        if (body[key] !== undefined) partial[key] = body[key]
      }
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update', allowed: EDITABLE_FIELDS })
      }
      const updated = await configService.update(uid, partial)
      res.json({ config: updated })
    } catch (err) {
      logger.error({ err: err.message }, 'Patch config error')
      res.status(500).json({ error: 'Failed to update config' })
    }
  })

  router.post('/refresh', authenticate, async (req, res) => {
    try {
      const uid = targetUserId(req)
      const cfg = await configService.refresh(uid)
      res.json({ config: cfg })
    } catch (err) {
      res.status(500).json({ error: 'Failed to refresh config' })
    }
  })

  // Field schema (for frontend form builder)
  router.get('/schema', authenticate, (req, res) => {
    res.json({
      fields: [
        { key: 'botName', type: 'string', label: 'Nama Bot', maxLength: 64 },
        { key: 'botNumber', type: 'string', label: 'Nomor Bot (display)', maxLength: 20 },
        { key: 'ownerName', type: 'string', label: 'Nama Owner', maxLength: 64 },
        { key: 'ownerNumbers', type: 'array', label: 'Nomor Owner', itemType: 'string', hint: 'Array atau string dipisah koma' },
        { key: 'prefix', type: 'string', label: 'Prefix Command', maxLength: 5 },
        { key: 'publicMode', type: 'boolean', label: 'Mode Publik (semua user bisa pakai)' },
        { key: 'antiSpam', type: 'boolean', label: 'Anti Spam' },
        { key: 'antiSpamCooldownMs', type: 'number', label: 'Cooldown Anti Spam (ms)' },
        { key: 'menuTitle', type: 'string', label: 'Judul Menu' },
        { key: 'welcomeMessage', type: 'string', label: 'Pesan Welcome', hint: 'Gunakan {prefix} untuk prefix' },
        { key: 'ownerOnlyMessage', type: 'string', label: 'Pesan Owner Only' },
        { key: 'maintenanceMode', type: 'boolean', label: 'Mode Maintenance' },
        { key: 'maintenanceMessage', type: 'string', label: 'Pesan Maintenance' },
        { key: 'maxSessionsPerUser', type: 'number', label: 'Max Session per User' },
        { key: 'extra', type: 'object', label: 'Extra (custom JSON)' },
      ],
    })
  })

  return router
}
