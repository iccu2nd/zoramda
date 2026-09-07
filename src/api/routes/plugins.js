import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import configService from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'

/**
 * Plugin response editor API.
 * Plugins declare editable text via `handler.responses = { key: 'default text' }`.
 * Each user can override those defaults for their own bot — no code edits needed.
 *
 * @param {import('../../core/SessionManager.js').SessionManager} sessionManager
 */
export default function createPluginRoutes(sessionManager) {
  const router = Router()

  router.use(authenticate)

  // List every loaded plugin (all commands found under /plugins), each with
  // its editable responses (defaults + this user's overrides) if any exist.
  router.get('/', async (req, res) => {
    try {
      const plugins = sessionManager.pluginLoader.getAllPlugins()
      const userId = req.user.userId
      const out = plugins.map((p) => {
        const defaults = p.handler.responses || {}
        const keys = Object.keys(defaults)
        const command = p.commands[0]
        const overrides = keys.length ? configService.getPluginResponses(userId, command) : {}
        const responses = {}
        for (const key of keys) {
          responses[key] = {
            default: defaults[key],
            value: overrides[key] !== undefined ? overrides[key] : defaults[key],
            overridden: overrides[key] !== undefined,
          }
        }
        return {
          command,
          commands: p.commands,
          help: p.help,
          tags: p.tags,
          file: p.file,
          editable: keys.length > 0,
          responses,
        }
      })

      res.json({ plugins: out })
    } catch (err) {
      logger.error({ err: err.message }, 'List plugins error')
      res.status(500).json({ error: 'Failed to list plugins' })
    }
  })

  // Update response overrides for one plugin (identified by its primary command)
  router.patch('/:command/responses', async (req, res) => {
    try {
      const command = String(req.params.command).toLowerCase()
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
          // Empty string resets to default
          partial[key] = val === '' ? undefined : val.slice(0, 2000)
        }
      }
      if (Object.keys(partial).length === 0) {
        return res.status(400).json({ error: 'No valid response keys to update', allowed: allowedKeys })
      }

      const updated = await configService.updatePluginResponses(req.user.userId, plugin.commands[0], partial)
      res.json({ responses: updated[plugin.commands[0]] || {} })
    } catch (err) {
      logger.error({ err: err.message }, 'Update plugin responses error')
      res.status(500).json({ error: 'Failed to update plugin responses' })
    }
  })

  return router
}
