import { Router } from 'express'
import { authenticate, requireFeature } from '../middleware/auth.js'
import configService, { PERMISSIONS } from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'

/**
 * Plugin management API — list + per-session enable/permission + response overrides.
 *
 * @param {import('../../core/SessionManager.js').SessionManager} sessionManager
 */
export default function createPluginRoutes(sessionManager) {
  const router = Router()

  router.use(authenticate)
  router.use(requireFeature('botSettings'))

  async function assertSession(req, sessionId) {
    await sessionManager.assertOwnership(sessionId, req.user.userId, req.user.isAdmin)
  }

  /**
   * GET /api/plugins
   * Global list of loaded plugins (code), no session state.
   */
  router.get('/', async (req, res) => {
    try {
      const plugins = sessionManager.pluginLoader.getAllPlugins()
      const out = plugins.map((p) => ({
        file: p.file,
        commands: p.commands,
        help: p.help,
        tags: p.tags,
        defaultPermissions: p.permissions || ['everyone'],
        hasResponses: !!(p.handler.responses && Object.keys(p.handler.responses).length),
      }))
      res.json({ plugins: out, permissions: PERMISSIONS })
    } catch (err) {
      logger.error({ err: err.message }, 'List plugins error')
      res.status(500).json({ error: 'Failed to list plugins' })
    }
  })

  /**
   * GET /api/plugins/session/:sessionId
   * All plugins + this session's enabled/permission state.
   */
  router.get('/session/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params
      await assertSession(req, sessionId)

      // Ensure config is warm
      await configService.getConfig(sessionId, req.user.userId)

      const plugins = sessionManager.pluginLoader.getAllPlugins()
      const out = plugins.map((p) => {
        const defaultPerms = p.permissions || ['everyone']
        const state = configService.getPluginState(sessionId, p.file, defaultPerms)
        const defaults = p.handler.responses || {}
        const overrides = configService.getPluginResponses(sessionId, p.commands[0])
        const responses = {}
        for (const key of Object.keys(defaults)) {
          responses[key] = {
            default: defaults[key],
            value: overrides[key] !== undefined ? overrides[key] : defaults[key],
            overridden: overrides[key] !== undefined,
          }
        }
        const effectiveCommands =
          state.commands && state.commands.length ? state.commands : p.commands
        return {
          file: p.file,
          commands: effectiveCommands,
          defaultCommands: p.commands,
          customCommands: state.commands || null,
          help: p.help,
          tags: p.tags,
          enabled: state.enabled,
          permissions: state.permissions,
          defaultPermissions: defaultPerms,
          useLimit: !!state.useLimit,
          limitCost: state.limitCost || 0,
          responses,
        }
      })

      res.json({ sessionId, plugins: out, permissions: PERMISSIONS })
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      logger.error({ err: err.message }, 'List session plugins error')
      res.status(500).json({ error: 'Failed to list session plugins' })
    }
  })

  /**
   * PATCH /api/plugins/session/:sessionId
   * Body: { plugins: { "main/ping.js": { enabled: true, permission: "everyone" }, ... } }
   */
  router.patch('/session/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params
      await assertSession(req, sessionId)

      const states = req.body?.plugins || req.body || {}
      if (!states || typeof states !== 'object' || Array.isArray(states)) {
        return res.status(400).json({ error: 'Body must be { plugins: { [file]: { enabled, permission } } }' })
      }

      // If wrapped under "plugins" key already handled; otherwise treat whole body as states
      const map = req.body?.plugins && typeof req.body.plugins === 'object' ? req.body.plugins : states

      const updated = await configService.updatePluginStates(sessionId, req.user.userId, map)
      res.json({ sessionId, plugins: updated })
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      logger.error({ err: err.message }, 'Update plugin states error')
      res.status(500).json({ error: 'Failed to update plugin states' })
    }
  })

  /**
   * PATCH /api/plugins/session/:sessionId/:command/responses
   */
  router.patch('/session/:sessionId/:command/responses', async (req, res) => {
    try {
      const { sessionId, command: rawCmd } = req.params
      await assertSession(req, sessionId)

      const command = String(rawCmd).toLowerCase()
      const plugin = sessionManager.pluginLoader
        .getAllPlugins()
        .find((p) => p.commands.includes(command))

      if (!plugin) return res.status(404).json({ error: 'Plugin not found' })

      const defaults = plugin.handler.responses || {}
      const allowedKeys = Object.keys(defaults)
      if (allowedKeys.length === 0) {
        return res.status(400).json({ error: 'Plugin has no editable responses' })
      }

      const body = req.body || {}
      const partial = {}
      for (const key of allowedKeys) {
        if (body[key] !== undefined) {
          const val = String(body[key])
          partial[key] = val === '' ? undefined : val.slice(0, 2000)
        }
      }
      if (Object.keys(partial).length === 0) {
        return res
          .status(400)
          .json({ error: 'No valid response keys to update', allowed: allowedKeys })
      }

      const updated = await configService.updatePluginResponses(
        sessionId,
        req.user.userId,
        plugin.commands[0],
        partial
      )
      res.json({ sessionId, responses: updated[plugin.commands[0]] || {} })
    } catch (err) {
      if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message })
      logger.error({ err: err.message }, 'Update plugin responses error')
      res.status(500).json({ error: 'Failed to update plugin responses' })
    }
  })

  return router
}
