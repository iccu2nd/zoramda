import { readdir, readFile, writeFile, mkdir, unlink, access, watch } from 'node:fs/promises'
import { join, relative, dirname, resolve, sep, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import logger from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGINS_ROOT = join(__dirname, '../../plugins')
const EMPTY_HANDLERS = Object.freeze([])

/** Allowed top-level plugin folders */
const ALLOWED_FOLDERS = new Set([
  'main',
  'tools',
  'group',
  'admin',
  'downloader',
  'owner',
  'sticker',
  'other',
])

/**
 * Resolve a relative plugin path safely under PLUGINS_ROOT.
 * Accepts "main/ping.js" or "tools/foo.js". Rejects traversal / absolute paths.
 * @param {string} rel
 * @returns {string} absolute path
 */
export function resolvePluginPath(rel) {
  const raw = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
  if (!raw || raw.includes('..') || raw.startsWith('.') || raw.includes('\0')) {
    const err = new Error('Path plugin tidak valid')
    err.code = 'INVALID_PATH'
    throw err
  }
  if (!raw.endsWith('.js')) {
    const err = new Error('File plugin harus berakhiran .js')
    err.code = 'INVALID_PATH'
    throw err
  }
  const parts = raw.split('/').filter(Boolean)
  if (parts.length < 2 || parts.length > 3) {
    const err = new Error('Path harus berbentuk folder/nama.js (contoh: tools/hello.js)')
    err.code = 'INVALID_PATH'
    throw err
  }
  const folder = parts[0]
  const file = parts[parts.length - 1]
  if (!ALLOWED_FOLDERS.has(folder)) {
    const err = new Error(
      `Folder tidak diizinkan. Pakai: ${[...ALLOWED_FOLDERS].join(', ')}`
    )
    err.code = 'INVALID_PATH'
    throw err
  }
  if (!/^[a-zA-Z0-9_-]+\.js$/.test(file) || file.startsWith('_')) {
    const err = new Error('Nama file hanya huruf/angka/_/- dan tidak boleh diawali _')
    err.code = 'INVALID_PATH'
    throw err
  }
  const abs = resolve(PLUGINS_ROOT, ...parts)
  const rootResolved = resolve(PLUGINS_ROOT)
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    const err = new Error('Path di luar folder plugins')
    err.code = 'INVALID_PATH'
    throw err
  }
  return abs
}

export function getPluginTemplate({ folder = 'tools', name = 'hello', command = 'hello' } = {}) {
  const cmd = String(command || name || 'hello')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '') || 'hello'
  const tag = ALLOWED_FOLDERS.has(folder) ? folder : 'tools'
  return `/**
 * Plugin: ${tag}/${cmd}.js
 *
 * Handler menerima (m, ctx):
 *   m.reply(text|object)  — balas pesan
 *   m.react(emoji)        — reaksi
 *   m.chat, m.sender, m.isGroup, m.args, m.command, m.quoted, …
 *   m.quoted?.download()  — unduh media yang di-reply
 *
 * ctx:
 *   conn          — socket Baileys (+ wrapper sendSticker/sendAudio/sendAlbum/sendButton)
 *   text, args, usedPrefix, command, sessionId, userId
 *   isOwner, isPremium, botConfig, botName, responses
 *   plugins       — PluginLoader (getMenuByTags, getHandlers, …)
 *   config.get / config.update / config.isOwner / config.ban / …
 *
 * Metadata:
 *   handler.command    string | string[]
 *   handler.help       string | string[]
 *   handler.tags       string | string[]
 *   handler.permission 'everyone' | 'group' | 'private' | 'admin' | 'botadmin' | 'owner' | 'premium'
 *   handler.heavy      true → jalankan di heavyQueue (download/media/broadcast)
 *   handler.responses  { key: 'template {prefix} {botName}' }
 */
let handler = async (m, { conn, usedPrefix, command, args, text, isOwner, isPremium, responses, config, botName }) => {
  // contoh ringan — balas teks
  const name = args[0] || m.pushName || 'teman'
  await m.reply(responses.hello.replace('{name}', name).replace('{botName}', botName || 'Bot'))

  // contoh wrapper (uncomment jika perlu):
  // await conn.sendSticker(m.chat, buffer, m.raw, { packname: 'Pack', author: 'Author' })
  // await conn.sendAudio(m.chat, bufferOrUrl, true, m.raw)
  // await m.react('✅')
}

handler.help = ['${cmd}']
handler.tags = ['${tag}']
handler.command = ['${cmd}']
handler.permission = 'everyone'
// handler.heavy = true
handler.responses = {
  hello: 'Halo {name}! Bot *{botName}* siap membantu.',
}

export default handler
`
}

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
    /** @type {object[]|null} cached Array.from(plugins.values()) — avoid alloc on hot path */
    this._allPluginsCache = null
    this.watcher = null
    this.reloadDebounce = null
    this.isLoading = false
  }

  async init() {
    await this.loadAll()
    // Hot-reload only in development — saves file-watch overhead in production
    if (process.env.NODE_ENV !== 'production') {
      this.startWatcher()
    }
    logger.info({ count: this.plugins.size, commands: this.commands.size }, 'Plugins loaded')
  }

  async loadAll() {
    if (this.isLoading) return
    this.isLoading = true
    try {
      const files = await this.scanJsFiles(PLUGINS_ROOT)
      const newPlugins = new Map()
      const newCommands = new Map()

      // Parallel import (bounded) — faster cold start
      const CONCURRENCY = 8
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        const chunk = files.slice(i, i + CONCURRENCY)
        const results = await Promise.all(
          chunk.map(async (filePath) => {
            try {
              return await this.importPlugin(filePath)
            } catch (err) {
              logger.error({ file: filePath, err: err.message }, 'Failed to load plugin')
              return null
            }
          })
        )
        for (let j = 0; j < results.length; j++) {
          const plugin = results[j]
          if (!plugin) continue
          newPlugins.set(chunk[j], plugin)
          this.registerCommands(plugin, newCommands)
        }
      }

      // Atomic swap – no partial state visible to message handler
      this.plugins = newPlugins
      this.commands = newCommands
      this._allPluginsCache = Array.from(newPlugins.values())
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
   * Get handlers for a command. Returns shared array — callers must not mutate.
   */
  getHandlers(command) {
    return this.commands.get(String(command).toLowerCase()) || EMPTY_HANDLERS
  }

  getAllPlugins() {
    if (this._allPluginsCache) return this._allPluginsCache
    this._allPluginsCache = Array.from(this.plugins.values())
    return this._allPluginsCache
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

  /** Immediate full reload (admin save/delete). */
  async reloadNow() {
    if (this.reloadDebounce) {
      clearTimeout(this.reloadDebounce)
      this.reloadDebounce = null
    }
    await this.loadAll()
    logger.info({ count: this.plugins.size }, 'Plugins reloaded (admin)')
    return { count: this.plugins.size, commands: this.commands.size }
  }

  /**
   * List plugin files on disk + loaded metadata.
   */
  async listSources() {
    const files = await this.scanJsFiles(PLUGINS_ROOT)
    const loaded = new Map()
    for (const p of this.getAllPlugins()) loaded.set(p.file, p)

    const out = []
    for (const abs of files) {
      const file = relative(PLUGINS_ROOT, abs).replace(/\\/g, '/')
      const meta = loaded.get(file)
      out.push({
        file,
        folder: file.split('/')[0],
        loaded: !!meta,
        commands: meta?.commands || [],
        help: meta?.help || [],
        tags: meta?.tags || [],
        permissions: meta?.permissions || [],
        heavy: !!meta?.handler?.heavy,
      })
    }
    out.sort((a, b) => a.file.localeCompare(b.file))
    return out
  }

  async readSource(rel) {
    const abs = resolvePluginPath(rel)
    const source = await readFile(abs, 'utf8')
    const file = relative(PLUGINS_ROOT, abs).replace(/\\/g, '/')
    const meta = this.getAllPlugins().find((p) => p.file === file) || null
    return {
      file,
      source,
      loaded: !!meta,
      commands: meta?.commands || [],
      help: meta?.help || [],
      tags: meta?.tags || [],
      permissions: meta?.permissions || [],
      heavy: !!meta?.handler?.heavy,
    }
  }

  /**
   * Create or overwrite a plugin source file, then reload all plugins.
   * Validates that the new module exports a default function with commands.
   */
  async writeSource(rel, source) {
    const abs = resolvePluginPath(rel)
    const code = String(source || '')
    if (!code.trim()) {
      const err = new Error('Source tidak boleh kosong')
      err.code = 'EMPTY_SOURCE'
      throw err
    }
    if (code.length > 500_000) {
      const err = new Error('Source terlalu besar (max 500KB)')
      err.code = 'SOURCE_TOO_LARGE'
      throw err
    }
    // Basic safety: must look like an ESM plugin
    if (!/export\s+default\s+/.test(code)) {
      const err = new Error('Plugin harus punya `export default handler`')
      err.code = 'INVALID_SOURCE'
      throw err
    }

    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, code, 'utf8')

    // Reload — if this file fails to import, loadAll skips it and logs; surface that
    const before = new Set(this.getAllPlugins().map((p) => p.file))
    const result = await this.reloadNow()
    const file = relative(PLUGINS_ROOT, abs).replace(/\\/g, '/')
    const loaded = this.getAllPlugins().find((p) => p.file === file)
    if (!loaded) {
      const err = new Error(
        'File tersimpan tapi gagal di-load (cek export default, command, atau syntax error di log server)'
      )
      err.code = 'LOAD_FAILED'
      err.file = file
      throw err
    }
    return {
      file,
      created: !before.has(file),
      commands: loaded.commands,
      help: loaded.help,
      tags: loaded.tags,
      permissions: loaded.permissions,
      heavy: !!loaded.handler?.heavy,
      reload: result,
    }
  }

  async deleteSource(rel) {
    const abs = resolvePluginPath(rel)
    const file = relative(PLUGINS_ROOT, abs).replace(/\\/g, '/')
    try {
      await access(abs)
    } catch {
      const err = new Error('File tidak ditemukan')
      err.code = 'NOT_FOUND'
      throw err
    }
    await unlink(abs)
    const result = await this.reloadNow()
    return { file, deleted: true, reload: result }
  }

  getFolders() {
    return [...ALLOWED_FOLDERS]
  }

  async stop() {
    if (this._watchAbort) this._watchAbort.abort()
    if (this.reloadDebounce) clearTimeout(this.reloadDebounce)
  }
}

export default PluginLoader
