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
  botName: 'ZoraBot',
  botNumber: null,
  ownerNumbers: [],
  ownerName: 'Owner',
  prefix: '.',
  publicMode: true,
  antiSpam: true,
  antiSpamCooldownMs: 2000,
  readMessages: false,
  sendTyping: false,
  sendRecording: false,
  menuTitle: 'ZoraBot Menu',
  welcomeMessage: 'Halo! Ketik {prefix}menu untuk melihat perintah.',
  ownerOnlyMessage: 'Perintah ini hanya untuk owner.',
  maintenanceMode: false,
  maintenanceMessage: 'Bot sedang maintenance. Coba lagi nanti.',
  maxSessionsPerUser: staticConfig.session?.maxPerUser || 5,
  bannedUsers: [],
  pluginResponses: {},
  plugins: {},
  extra: {},
}

const EDITABLE_FIELDS = [
  'botName',
  'botNumber',
  'ownerNumbers',
  'ownerName',
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
  'maintenanceMode',
  'maintenanceMessage',
  'maxSessionsPerUser',
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

  for (const b of [
    'publicMode',
    'antiSpam',
    'maintenanceMode',
    'readMessages',
    'sendTyping',
    'sendRecording',
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
      }
    }
    return {
      enabled: state.enabled !== false,
      // If session has never customized permissions, fall back to plugin defaults
      permissions: Array.isArray(state.permissions) && state.permissions.length
        ? normalizePermList(state.permissions, defaults)
        : defaults,
    }
  }

  async updatePluginStates(sessionId, userId, states) {
    await safeGetOrCreate(sessionId, userId)

    const set = {}
    for (const [file, val] of Object.entries(states || {})) {
      if (!val || typeof val !== 'object') continue
      if (val.enabled !== undefined) {
        set[`plugins.${file}.enabled`] = Boolean(val.enabled)
      }
      if (val.permissions !== undefined || val.permission !== undefined) {
        const list = normalizePermList(val.permissions ?? val.permission, ['everyone'])
        set[`plugins.${file}.permissions`] = list
      }
    }

    if (!Object.keys(set).length) {
      return this.getCached(sessionId).plugins
    }

    const updated = await SessionConfig.findOneAndUpdate(
      { sessionId },
      { $set: set },
      { new: true }
    ).lean()

    const cfg = toCache(updated)
    this._cache.set(sessionId, cfg)
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
