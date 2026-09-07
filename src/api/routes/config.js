import { Router } from 'express'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import configService, { EDITABLE_FIELDS } from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'

/**
 * Config API – view & edit bot settings from web/dashboard
 */
export default function createConfigRoutes() {
  const router = Router()

  // Public / authenticated: read non-sensitive settings
  router.get('/', authenticate, async (req, res) => {
    try {
      if (req.user?.isAdmin) {
        return res.json({ config: configService.getAll() })
      }
      // Regular user: public fields only
      res.json({ config: configService.getPublic() })
    } catch (err) {
      logger.error({ err: err.message }, 'Get config error')
      res.status(500).json({ error: 'Failed to get config' })
    }
  })

  // Admin only: full update
  router.put('/', authenticate, requireAdmin, async (req, res) => {
    try {
      const body = req.body || {}
      // Strip unknown keys
      const partial = {}
      for (const key of EDITABLE_FIELDS) {
        if (body[key] !== undefined) partial[key] = body[key]
      }
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update', allowed: EDITABLE_FIELDS })
      }
      const updated = await configService.update(partial)
      res.json({ config: updated })
    } catch (err) {
      logger.error({ err: err.message }, 'Update config error')
      res.status(500).json({ error: 'Failed to update config' })
    }
  })

  // Admin: partial patch (same as PUT for convenience)
  router.patch('/', authenticate, requireAdmin, async (req, res) => {
    try {
      const body = req.body || {}
      const partial = {}
      for (const key of EDITABLE_FIELDS) {
        if (body[key] !== undefined) partial[key] = body[key]
      }
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update', allowed: EDITABLE_FIELDS })
      }
      const updated = await configService.update(partial)
      res.json({ config: updated })
    } catch (err) {
      logger.error({ err: err.message }, 'Patch config error')
      res.status(500).json({ error: 'Failed to update config' })
    }
  })

  // Admin: force reload from DB
  router.post('/refresh', authenticate, requireAdmin, async (req, res) => {
    try {
      const config = await configService.refresh()
      res.json({ config })
    } catch (err) {
      res.status(500).json({ error: 'Failed to refresh config' })
    }
  })

  // List editable field schema (for frontend form builder)
  router.get('/schema', authenticate, requireAdmin, (req, res) => {
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
