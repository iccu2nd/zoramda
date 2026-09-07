import { readdir, watch } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import logger from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGINS_ROOT = join(__dirname, '../../plugins')

/**
 * Production-ready plugin loader with:
 * - Recursive subfolder scan
 * - Hot-reload without process restart
 * - No duplicate handlers
 * - Isolated error per plugin
 * - Safe command registry
 */
export class PluginLoader {
  constructor() {
    /** @type {Map<string, object>} path -> plugin module */
    this.plugins = new Map()
    /** @type {Map<string, object[]>} command -> list of handlers */
    this.commands = new Map()
    this.watcher = null
    this.reloadDebounce = null
    this.isLoading = false
  }

  async init() {
    await this.loadAll()
    this.startWatcher()
    logger.info({ count: this.plugins.size, commands: this.commands.size }, 'Plugins loaded')
  }

  async loadAll() {
    if (this.isLoading) return
    this.isLoading = true
    try {
      const files = await this.scanJsFiles(PLUGINS_ROOT)
      const newPlugins = new Map()
      const newCommands = new Map()

      for (const filePath of files) {
        try {
          const plugin = await this.importPlugin(filePath)
          if (!plugin) continue
          newPlugins.set(filePath, plugin)
          this.registerCommands(plugin, newCommands)
        } catch (err) {
          logger.error({ file: filePath, err: err.message }, 'Failed to load plugin')
        }
      }

      // Atomic swap – no partial state visible to message handler
      this.plugins = newPlugins
      this.commands = newCommands
    } finally {
      this.isLoading = false
    }
  }

  async scanJsFiles(dir) {
    const results = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...(await this.scanJsFiles(full)))
        } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('_')) {
          results.push(full)
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error({ dir, err: err.message }, 'Plugin scan error')
      }
    }
    return results
  }

  async importPlugin(filePath) {
    // Cache-bust for hot-reload
    const url = pathToFileURL(filePath).href + `?t=${Date.now()}`
    const mod = await import(url)
    const handler = mod.default

    if (!handler || typeof handler !== 'function') {
      logger.warn({ file: filePath }, 'Plugin has no default export function')
      return null
    }

    // Normalize metadata
    const commands = Array.isArray(handler.command)
      ? handler.command.map((c) => String(c).toLowerCase())
      : handler.command
        ? [String(handler.command).toLowerCase()]
        : []

    if (commands.length === 0) {
      logger.warn({ file: relative(PLUGINS_ROOT, filePath) }, 'Plugin has no command')
      return null
    }

    // Normalize permission to array (supports string or string[])
    let permissions = ['everyone']
    if (handler.permission != null) {
      const raw = handler.permission
      permissions = (Array.isArray(raw) ? raw : [raw])
        .map((x) => String(x).toLowerCase())
        .filter(Boolean)
      if (!permissions.length) permissions = ['everyone']
    }

    return {
      handler,
      commands,
      help: handler.help || commands,
      tags: handler.tags || ['other'],
      permissions,
      file: relative(PLUGINS_ROOT, filePath),
    }
  }

  registerCommands(plugin, commandMap) {
    for (const cmd of plugin.commands) {
      if (!commandMap.has(cmd)) commandMap.set(cmd, [])
      commandMap.get(cmd).push(plugin)
    }
  }

  /**
   * Get handlers for a command (copy to avoid mutation during execution)
   */
  getHandlers(command) {
    const list = this.commands.get(command.toLowerCase())
    return list ? [...list] : []
  }

  getAllPlugins() {
    return Array.from(this.plugins.values())
  }

  getMenuByTags() {
    const byTag = {}
    for (const p of this.plugins.values()) {
      const tags = Array.isArray(p.tags) ? p.tags : [p.tags]
      for (const tag of tags) {
        if (!byTag[tag]) byTag[tag] = []
        byTag[tag].push(...(Array.isArray(p.help) ? p.help : [p.help]))
      }
    }
    return byTag
  }

  startWatcher() {
    // Use fs.watch with debounce – works on most platforms
    // For production containers, consider chokidar if needed
    try {
      // Node 20+ recursive watch
      const controller = new AbortController()
      this._watchAbort = controller

      ;(async () => {
        try {
          const watcher = watch(PLUGINS_ROOT, { recursive: true, signal: controller.signal })
          for await (const event of watcher) {
            if (!event.filename || !event.filename.endsWith('.js')) continue
            this.scheduleReload()
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            logger.warn({ err: err.message }, 'Plugin watcher stopped')
          }
        }
      })()
    } catch (err) {
      logger.warn({ err: err.message }, 'Plugin hot-reload watcher not available')
    }
  }

  scheduleReload() {
    if (this.reloadDebounce) clearTimeout(this.reloadDebounce)
    this.reloadDebounce = setTimeout(async () => {
      logger.info('Reloading plugins...')
      try {
        await this.loadAll()
        logger.info({ count: this.plugins.size }, 'Plugins reloaded')
      } catch (err) {
        logger.error({ err: err.message }, 'Plugin reload failed')
      }
    }, 300)
  }

  async stop() {
    if (this._watchAbort) this._watchAbort.abort()
    if (this.reloadDebounce) clearTimeout(this.reloadDebounce)
  }
}

export default PluginLoader
