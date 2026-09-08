/**
 * Runtime config service — per-session.
 * - Defaults baked in
 * - Overrides from MongoDB (editable via API / .set), one doc per sessionId
 * - In-memory cache keyed by sessionId – never hits DB on the message hot path
 * - Plugin enable/disable + permission stored per-session and applied at runtime
 */
import SessionConfig, { PERMISSIONS } from '../db/models/SessionConfig.js'
import staticConfig from '../config/index.js'
import logger from '../utils/logger.js'

const DEFAULTS = {
  botName: 'Botenv',
  botNumber: null,
  ownerNumbers: [],
  ownerName: 'Owner',
  packName: 'Botenv',
  author: '',
  prefix: '.',
  publicMode: true,
  antiSpam: true,
  antiSpamCooldownMs: 2000,
  readMessages: false,
  sendTyping: false,
  sendRecording: false,
  menuTitle: 'Botenv Menu',
  welcomeMessage: 'Halo! Ketik {prefix}menu untuk melihat perintah.',
  ownerOnlyMessage: 'Perintah ini hanya untuk owner.',
  adminOnlyMessage: 'Perintah ini hanya untuk admin grup.',
  groupOnlyMessage: 'Perintah ini hanya bisa dipakai di dalam grup.',
  privateOnlyMessage: 'Perintah ini hanya bisa dipakai lewat chat pribadi.',
  premiumOnlyMessage: 'Perintah ini khusus untuk member premium.',
  limitMessage: 'Limit kamu sudah habis. Tunggu limit reset atau upgrade ke premium.',
  maintenanceMode: false,
  maintenanceMessage: 'Bot sedang maintenance. Coba lagi nanti.',
  maxSessionsPerUser: staticConfig.session?.maxPerUser || 5,
  bannedUsers: [],
  premiumUsers: [],
  pluginResponses: {},
  plugins: {},
  useLimit: false,
  limitCost: 1,
  defaultLimit: 10,
  premiumUnlimited: true,
  premiumDefaultLimit: 100,
  userLimits: {},
  extra: {},
}

const EDITABLE_FIELDS = [
  'botName',
  'botNumber',
  'ownerNumbers',
  'ownerName',
  'packName',
  'author',
  'prefix',
  'publicMode',
  'antiSpam',
  'antiSpamCooldownMs',
  'readMessages',
  'sendTyping',
  'sendRecording',
  'menuTitle',
  'welcomeMessage',
  'ownerOnlyMessage',
  'adminOnlyMessage',
  'groupOnlyMessage',
  'privateOnlyMessage',
  'premiumOnlyMessage',
  'limitMessage',
  'maintenanceMode',
  'maintenanceMessage',
  'maxSessionsPerUser',
  'useLimit',
  'limitCost',
  'defaultLimit',
  'premiumUnlimited',
  'premiumDefaultLimit',
  'extra',
]

function cleanPartial(partial) {
  const clean = {}
  for (const key of EDITABLE_FIELDS) {
    if (partial[key] !== undefined) clean[key] = partial[key]
  }

  if (clean.ownerNumbers !== undefined) {
    if (typeof clean.ownerNumbers === 'string') {
      clean.ownerNumbers = clean.ownerNumbers
        .split(/[,;\s]+/)
        .map((n) => n.replace(/\D/g, ''))
        .filter(Boolean)
    } else if (Array.isArray(clean.ownerNumbers)) {
      clean.ownerNumbers = clean.ownerNumbers
        .map((n) => String(n).replace(/\D/g, ''))
        .filter(Boolean)
    } else {
      delete clean.ownerNumbers
    }
  }

  if (clean.prefix !== undefined) {
    clean.prefix = String(clean.prefix).slice(0, 5) || '.'
  }

  if (clean.antiSpamCooldownMs !== undefined) {
    clean.antiSpamCooldownMs = Math.max(0, parseInt(clean.antiSpamCooldownMs, 10) || 0)
  }
  if (clean.maxSessionsPerUser !== undefined) {
    clean.maxSessionsPerUser = Math.max(1, parseInt(clean.maxSessionsPerUser, 10) || 5)
  }
  if (clean.limitCost !== undefined) {
    clean.limitCost = Math.max(0, parseInt(clean.limitCost, 10) || 0)
  }
  if (clean.defaultLimit !== undefined) {
    clean.defaultLimit = Math.max(0, parseInt(clean.defaultLimit, 10) || 0)
  }
  if (clean.premiumDefaultLimit !== undefined) {
    clean.premiumDefaultLimit = Math.max(0, parseInt(clean.premiumDefaultLimit, 10) || 0)
  }

  for (const b of [
    'publicMode',
    'antiSpam',
    'maintenanceMode',
    'readMessages',
    'sendTyping',
    'sendRecording',
    'useLimit',
    'premiumUnlimited',
  ]) {
    if (clean[b] !== undefined) clean[b] = Boolean(clean[b])
  }

  return clean
}

function normalizePermList(val, fallback = ['everyone']) {
  let list = []
  if (Array.isArray(val)) list = val
  else if (typeof val === 'string' && val) list = [val]
  else if (val && typeof val === 'object' && Array.isArray(val.permissions)) list = val.permissions
  else if (val && typeof val === 'object' && typeof val.permission === 'string') list = [val.permission]

  const cleaned = [...new Set(
    list.map((p) => String(p).toLowerCase()).filter((p) => PERMISSIONS.includes(p))
  )]
  return cleaned.length ? cleaned : [...fallback]
}

function normalizePlugins(raw) {
  const out = {}
  if (!raw) return out
  const entries =
    raw instanceof Map
      ? raw.entries()
      : typeof raw === 'object'
        ? Object.entries(raw)
        : []
  for (const [key, val] of entries) {
    if (!val || typeof val !== 'object') continue
    out[key] = {
      enabled: val.enabled !== false,
      permissions: normalizePermList(val.permissions ?? val.permission, ['everyone']),
      commands: Array.isArray(val.commands)
        ? val.commands.map((c) => String(c).toLowerCase().trim()).filter(Boolean)
        : undefined,
    }
  }
  return out
}

function toCache(doc) {
  if (!doc) return { ...DEFAULTS, pluginResponses: {}, plugins: {} }

  const next = { ...DEFAULTS }
  for (const key of EDITABLE_FIELDS) {
    if (doc[key] !== undefined && doc[key] !== null) {
      next[key] = doc[key]
    }
  }
  if (!Array.isArray(next.ownerNumbers)) next.ownerNumbers = []
  next.bannedUsers = Array.isArray(doc.bannedUsers) ? doc.bannedUsers : []
  next.premiumUsers = Array.isArray(doc.premiumUsers) ? doc.premiumUsers : []
  next.userLimits =
    doc.userLimits && typeof doc.userLimits === 'object' ? doc.userLimits : {}
  next.pluginResponses =
    doc.pluginResponses && typeof doc.pluginResponses === 'object' ? doc.pluginResponses : {}
  next.plugins = normalizePlugins(doc.plugins)
  return next
}

/**
 * Safe upsert that avoids the "Plan executor error during findAndModify"
 * race that appears when two concurrent upserts hit a unique index.
 */
async function safeGetOrCreate(sessionId, userId) {
  let doc = await SessionConfig.findOne({ sessionId }).lean()
  if (doc) return doc

  try {
    doc = await SessionConfig.create({
      sessionId,
      userId: userId || 'unknown',
      ...DEFAULTS,
      plugins: {},
      pluginResponses: {},
      bannedUsers: [],
      ownerNumbers: [],
    })
    return doc.toObject ? doc.toObject() : doc
  } catch (err) {
    const isDup = err.code === 11000 || /E11000/.test(err.message || '')
    if (isDup) {
      doc = await SessionConfig.findOne({ sessionId }).lean()
      if (doc) return doc
    }
    throw err
  }
}

class ConfigService {
  constructor() {
    /** @type {Map<string, object>} sessionId -> config */
    this._cache = new Map()
    /** @type {Map<string, Promise>} sessionId -> in-flight load */
    this._loading = new Map()
  }

  async warm(sessionId, userId) {
    return this.getConfig(sessionId, userId)
  }

  async getConfig(sessionId, userId) {
    if (!sessionId) return { ...DEFAULTS, plugins: {}, pluginResponses: {} }
    if (this._cache.has(sessionId)) return this._cache.get(sessionId)
    if (this._loading.has(sessionId)) return this._loading.get(sessionId)

    const promise = this._loadFromDb(sessionId, userId)
    this._loading.set(sessionId, promise)
    try {
      return await promise
    } finally {
      this._loading.delete(sessionId)
    }
  }

  async _loadFromDb(sessionId, userId) {
    try {
      const doc = await safeGetOrCreate(sessionId, userId)
      const cfg = toCache(doc)
      this._cache.set(sessionId, cfg)
      return cfg
    } catch (err) {
      logger.error(
        { sessionId, userId, err: err.message },
        'Failed to load SessionConfig – using defaults'
      )
      const cfg = { ...DEFAULTS, plugins: {}, pluginResponses: {} }
      this._cache.set(sessionId, cfg)
      return cfg
    }
  }

  getCached(sessionId) {
    if (sessionId && this._cache.has(sessionId)) return this._cache.get(sessionId)
    if (sessionId) this.warm(sessionId).catch(() => {})
    return { ...DEFAULTS, plugins: {}, pluginResponses: {} }
  }

  async update(sessionId, userId, partial) {
    const clean = cleanPartial(partial)
    await safeGetOrCreate(sessionId, userId)

    const doc = await SessionConfig.findOneAndUpdate(
      { sessionId },
      { $set: { ...clean, ...(userId ? { userId } : {}) } },
      { new: true }
    ).lean()

    const cfg = toCache(doc)
    this._cache.set(sessionId, cfg)
    logger.info({ sessionId, keys: Object.keys(clean) }, 'SessionConfig updated')
    return cfg
  }

  async refresh(sessionId, userId) {
    this._cache.delete(sessionId)
    return this._loadFromDb(sessionId, userId)
  }

  getPluginResponses(sessionId, command) {
    const cfg = this.getCached(sessionId)
    return (cfg.pluginResponses && cfg.pluginResponses[command]) || {}
  }

  async updatePluginResponses(sessionId, userId, command, partial) {
    await safeGetOrCreate(sessionId, userId)

    const set = {}
    const unset = {}
    for (const key of Object.keys(partial)) {
      const path = `pluginResponses.${command}.${key}`
      if (partial[key] === undefined) {
        unset[path] = ''
      } else {
        set[path] = partial[key]
      }
    }

    const update = {}
    if (Object.keys(set).length) update.$set = set
    if (Object.keys(unset).length) update.$unset = unset
    if (!Object.keys(update).length) {
      return this.getCached(sessionId).pluginResponses
    }

    const updated = await SessionConfig.findOneAndUpdate({ sessionId }, update, {
      new: true,
    }).lean()

    const cfg = toCache(updated)
    this._cache.set(sessionId, cfg)
    return cfg.pluginResponses
  }

  getPluginState(sessionId, pluginFile, defaultPermissions = ['everyone']) {
    const defaults = normalizePermList(defaultPermissions, ['everyone'])
    const cfg = this.getCached(sessionId)
    const state = cfg.plugins && cfg.plugins[pluginFile]
    if (!state) {
      return {
        enabled: true,
        permissions: defaults,
        commands: undefined,
      }
    }
    return {
      enabled: state.enabled !== false,
      permissions: Array.isArray(state.permissions) && state.permissions.length
        ? normalizePermList(state.permissions, defaults)
        : defaults,
      commands:
        Array.isArray(state.commands) && state.commands.length ? state.commands : undefined,
    }
  }

  /**
   * Resolve which plugin files handle a command for this session,
   * respecting per-session custom command aliases.
   * Returns Set of plugin file paths that should run for this command.
   */
  resolveCommandFiles(sessionId, command, allPlugins) {
    const cmd = String(command || '')
      .toLowerCase()
      .trim()
      .replace(/^\./, '')
    if (!cmd) return new Set()
    const cfg = this.getCached(sessionId)
    const matched = new Set()

    for (const p of allPlugins) {
      const state = cfg.plugins && cfg.plugins[p.file]
      // disabled plugins never match
      if (state && state.enabled === false) continue
      const custom =
        state && Array.isArray(state.commands) && state.commands.length
          ? state.commands.map((c) => String(c).toLowerCase().trim().replace(/^\./, ''))
          : null
      // custom set → use only custom; empty/undefined → plugin defaults
      const cmds = custom || p.commands || []
      if (cmds.includes(cmd)) matched.add(p.file)
    }
    return matched
  }

  async updatePluginStates(sessionId, userId, states) {
    await safeGetOrCreate(sessionId, userId)

    // Plugin file keys contain dots (e.g. "main/help.js").
    // Never use dotted $set paths like "plugins.main/help.js.commands"
    // — Mongo would nest them. Replace the whole `plugins` object instead.
    const doc = await SessionConfig.findOne({ sessionId })
    if (!doc) return {}

    // Normalize existing value to a plain object (legacy Map / nested corruption)
    let plugins = {}
    const raw = doc.plugins
    if (raw instanceof Map) {
      for (const [k, v] of raw.entries()) plugins[k] = v
    } else if (raw && typeof raw === 'object') {
      plugins = { ...raw }
    }

    let changed = false
    for (const [file, val] of Object.entries(states || {})) {
      if (!val || typeof val !== 'object') continue
      const prev = plugins[file]
      const cur =
        prev && typeof prev === 'object'
          ? {
              enabled: prev.enabled !== false,
              permissions: Array.isArray(prev.permissions)
                ? [...prev.permissions]
                : ['everyone'],
              commands: Array.isArray(prev.commands) ? [...prev.commands] : undefined,
            }
          : { enabled: true, permissions: ['everyone'], commands: undefined }

      if (val.enabled !== undefined) {
        cur.enabled = Boolean(val.enabled)
        changed = true
      }
      if (val.permissions !== undefined || val.permission !== undefined) {
        cur.permissions = normalizePermList(val.permissions ?? val.permission, ['everyone'])
        changed = true
      }
      if (val.commands !== undefined) {
        if (val.commands === null || (Array.isArray(val.commands) && val.commands.length === 0)) {
          // empty → revert to plugin defaults
          cur.commands = []
        } else if (Array.isArray(val.commands)) {
          cur.commands = val.commands
            .map((c) => String(c).toLowerCase().trim().replace(/^\./, ''))
            .filter(Boolean)
            .slice(0, 20)
        }
        changed = true
      }
      plugins[file] = cur
    }

    if (!changed) {
      return this.getCached(sessionId).plugins
    }

    doc.plugins = plugins
    doc.markModified('plugins')
    await doc.save()

    const lean = doc.toObject ? doc.toObject() : doc
    const cfg = toCache(lean)
    this._cache.set(sessionId, cfg)
    logger.info(
      { sessionId, files: Object.keys(states || {}) },
      'Plugin states updated'
    )
    return cfg.plugins
  }

  async banUser(sessionId, userId, jid) {
    await safeGetOrCreate(sessionId, userId)
    const updated = await SessionConfig.findOneAndUpdate(
      { sessionId },
      { $addToSet: { bannedUsers: jid } },
      { new: true }
    ).lean()
    const cfg = toCache(updated)
    this._cache.set(sessionId, cfg)
    return cfg.bannedUsers
  }

  async unbanUser(sessionId, userId, jid) {
    const updated = await SessionConfig.findOneAndUpdate(
      { sessionId },
      { $pull: { bannedUsers: jid } },
      { new: true }
    ).lean()
    const cfg = toCache(updated)
    this._cache.set(sessionId, cfg)
    return cfg.bannedUsers
  }

  getBannedUsers(sessionId) {
    return this.getCached(sessionId).bannedUsers || []
  }

  isBanned(sessionId, jid) {
    if (!jid) return false
    const num = String(jid).split('@')[0].replace(/\D/g, '')
    return this.getBannedUsers(sessionId).some(
      (b) => String(b).split('@')[0].replace(/\D/g, '') === num
    )
  }

  isOwner(sessionId, jid) {
    if (!jid) return false
    const cfg = this.getCached(sessionId)
    const num = String(jid).split('@')[0].replace(/\D/g, '')
    return (cfg.ownerNumbers || []).some((o) => String(o).replace(/\D/g, '') === num)
  }

  async addPremium(sessionId, userId, jid) {
    await safeGetOrCreate(sessionId, userId)
    const updated = await SessionConfig.findOneAndUpdate(
      { sessionId },
      { $addToSet: { premiumUsers: jid } },
      { new: true }
    ).lean()
    const cfg = toCache(updated)
    this._cache.set(sessionId, cfg)
    return cfg.premiumUsers
  }

  async removePremium(sessionId, userId, jid) {
    const updated = await SessionConfig.findOneAndUpdate(
      { sessionId },
      { $pull: { premiumUsers: jid } },
      { new: true }
    ).lean()
    const cfg = toCache(updated)
    this._cache.set(sessionId, cfg)
    return cfg.premiumUsers
  }

  getPremiumUsers(sessionId) {
    return this.getCached(sessionId).premiumUsers || []
  }

  isPremium(sessionId, jid) {
    if (!jid) return false
    const num = String(jid).split('@')[0].replace(/\D/g, '')
    return this.getPremiumUsers(sessionId).some(
      (p) => String(p).split('@')[0].replace(/\D/g, '') === num
    )
  }

  isLimitEnabled(sessionId) {
    return !!this.getCached(sessionId).useLimit
  }

  /**
   * Current remaining limit for a WhatsApp user, without consuming it.
   * Falls back to the plan's starting balance if the user has none stored yet.
   */
  getUserLimit(sessionId, jid) {
    if (!jid) return 0
    const cfg = this.getCached(sessionId)
    const key = String(jid).split('@')[0].replace(/\D/g, '')
    const stored = cfg.userLimits ? cfg.userLimits[key] : undefined
    if (stored !== undefined) return stored
    return this.isPremium(sessionId, jid) ? cfg.premiumDefaultLimit : cfg.defaultLimit
  }

  /**
   * Gate + spend limit for a command use.
   * HOT PATH: update in-memory cache immediately, persist to Mongo async
   * so light commands never wait on a DB round-trip.
   * Returns { allowed, remaining, cost }.
   */
  consumeLimit(sessionId, userId, jid) {
    const cfg = this.getCached(sessionId)
    const cost = Math.max(0, cfg.limitCost || 0)
    const current = this.getUserLimit(sessionId, jid)

    if (current < cost) {
      return { allowed: false, remaining: current, cost }
    }

    const next = current - cost
    const key = String(jid).split('@')[0].replace(/\D/g, '')

    // memory-first
    if (!cfg.userLimits || typeof cfg.userLimits !== 'object') cfg.userLimits = {}
    cfg.userLimits[key] = next
    this._cache.set(sessionId, cfg)

    // persist off the hot path
    setImmediate(() => {
      SessionConfig.findOneAndUpdate(
        { sessionId },
        { $set: { [`userLimits.${key}`]: next } },
        { upsert: false }
      ).catch((err) => {
        logger.warn({ sessionId, err: err.message }, 'Limit persist failed')
      })
    })

    return { allowed: true, remaining: next, cost }
  }

  async setUserLimit(sessionId, userId, jid, amount) {
    const key = String(jid).split('@')[0].replace(/\D/g, '')
    const value = Math.max(0, parseInt(amount, 10) || 0)
    await safeGetOrCreate(sessionId, userId)
    const updated = await SessionConfig.findOneAndUpdate(
      { sessionId },
      { $set: { [`userLimits.${key}`]: value } },
      { new: true }
    ).lean()
    const cfg = toCache(updated)
    this._cache.set(sessionId, cfg)
    return value
  }

  getPrefix(sessionId) {
    return this.getCached(sessionId).prefix || '.'
  }

  isMaintenance(sessionId) {
    return !!this.getCached(sessionId).maintenanceMode
  }

  isPublic(sessionId) {
    return this.getCached(sessionId).publicMode !== false
  }

  invalidate(sessionId) {
    this._cache.delete(sessionId)
  }

  async deleteSessionConfig(sessionId) {
    this._cache.delete(sessionId)
    try {
      await SessionConfig.deleteOne({ sessionId })
    } catch (err) {
      logger.warn({ sessionId, err: err.message }, 'Failed to delete SessionConfig')
    }
  }
}

const configService = new ConfigService()
export default configService
export { EDITABLE_FIELDS, DEFAULTS, PERMISSIONS }
