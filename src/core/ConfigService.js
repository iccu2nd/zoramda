/**
 * Runtime config service — per-user.
 * - Defaults baked in
 * - Overrides from MongoDB (editable via API / .set command), one doc per userId
 * - In-memory cache keyed by userId – never hits DB on the message hot path
 *   once a user's session has been warmed (see warm()).
 */
import BotConfig from '../db/models/BotConfig.js'
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
  menuTitle: 'ZoraBot Menu',
  welcomeMessage: 'Halo! Ketik {prefix}menu untuk melihat perintah.',
  ownerOnlyMessage: 'Perintah ini hanya untuk owner.',
  maintenanceMode: false,
  maintenanceMessage: 'Bot sedang maintenance. Coba lagi nanti.',
  maxSessionsPerUser: staticConfig.session?.maxPerUser || 5,
  pluginResponses: {},
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

  for (const b of ['publicMode', 'antiSpam', 'maintenanceMode']) {
    if (clean[b] !== undefined) clean[b] = Boolean(clean[b])
  }

  return clean
}

function toCache(doc) {
  const next = { ...DEFAULTS }
  for (const key of EDITABLE_FIELDS) {
    if (doc[key] !== undefined && doc[key] !== null) {
      next[key] = doc[key]
    }
  }
  if (!Array.isArray(next.ownerNumbers)) next.ownerNumbers = []
  next.pluginResponses = doc.pluginResponses && typeof doc.pluginResponses === 'object' ? doc.pluginResponses : {}
  return next
}

class ConfigService {
  constructor() {
    /** @type {Map<string, object>} userId -> config */
    this._cache = new Map()
    /** @type {Map<string, Promise>} userId -> in-flight load */
    this._loading = new Map()
  }

  /**
   * Ensure a user's config is loaded into cache. Safe to call repeatedly.
   */
  async warm(userId) {
    return this.getConfig(userId)
  }

  /**
   * Load (or lazily seed) a user's config from DB and cache it.
   */
  async getConfig(userId) {
    if (!userId) return { ...DEFAULTS }
    if (this._cache.has(userId)) return this._cache.get(userId)
    if (this._loading.has(userId)) return this._loading.get(userId)

    const promise = this._loadFromDb(userId)
    this._loading.set(userId, promise)
    try {
      return await promise
    } finally {
      this._loading.delete(userId)
    }
  }

  async _loadFromDb(userId) {
    try {
      // Atomic find-or-create: findOneAndUpdate+upsert instead of a separate
      // findOne then create. The old two-step version let two concurrent
      // calls for the same new userId both pass the findOne check and then
      // both try to insert, so the second one hit the unique index on
      // `userId` with E11000 duplicate key.
      let doc = await BotConfig.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId, ...DEFAULTS } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean()
      const cfg = toCache(doc)
      this._cache.set(userId, cfg)
      return cfg
    } catch (err) {
      // Duplicate key can still happen in a true race (two upserts landing
      // at once) — that just means the doc now exists, so re-read it.
      if (err.code === 11000) {
        try {
          const doc = await BotConfig.findOne({ userId }).lean()
          if (doc) {
            const cfg = toCache(doc)
            this._cache.set(userId, cfg)
            return cfg
          }
        } catch (_) {
          // fall through to defaults below
        }
      }
      logger.error({ userId, err: err.message }, 'Failed to load BotConfig – using defaults')
      const cfg = { ...DEFAULTS }
      this._cache.set(userId, cfg)
      return cfg
    }
  }

  /**
   * Synchronous read from cache only (hot path). Returns defaults if not
   * warmed yet, and kicks off a background warm so the next read is fresh.
   */
  getCached(userId) {
    if (userId && this._cache.has(userId)) return this._cache.get(userId)
    if (userId) this.warm(userId).catch(() => {})
    return { ...DEFAULTS }
  }

  async update(userId, partial) {
    const clean = cleanPartial(partial)
    const doc = await BotConfig.findOneAndUpdate(
      { userId },
      { $set: clean },
      { upsert: true, new: true }
    ).lean()
    const cfg = toCache(doc)
    this._cache.set(userId, cfg)
    logger.info({ userId, keys: Object.keys(clean) }, 'BotConfig updated')
    return cfg
  }

  async refresh(userId) {
    return this._loadFromDb(userId)
  }

  /* ——— plugin response overrides ——— */

  getPluginResponses(userId, command) {
    const cfg = this.getCached(userId)
    return (cfg.pluginResponses && cfg.pluginResponses[command]) || {}
  }

  async updatePluginResponses(userId, command, partial) {
    // Build a dot-notation $set so the update is atomic on Mongo's side —
    // no more findOne-then-merge-then-write. The old read-merge-write
    // pattern raced with itself under upsert:true (two calls for the same
    // not-yet-existing userId could both try to insert), which surfaced as
    // "Plan executor error during findAndModify :: caused by :: E11000
    // duplicate key". It also silently dropped concurrent updates to
    // different commands (lost update).
    const set = {}
    for (const key of Object.keys(partial)) {
      set[`pluginResponses.${command}.${key}`] = partial[key]
    }

    let updated
    try {
      updated = await BotConfig.findOneAndUpdate(
        { userId },
        { $set: set, $setOnInsert: { userId } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean()
    } catch (err) {
      if (err.code === 11000) {
        // Lost the upsert race — the doc exists now, retry as a plain update.
        updated = await BotConfig.findOneAndUpdate(
          { userId },
          { $set: set },
          { new: true }
        ).lean()
      } else {
        throw err
      }
    }

    const cfg = toCache(updated)
    this._cache.set(userId, cfg)
    return cfg.pluginResponses
  }

  /* ——— convenience helpers used on the message hot path ——— */

  isOwner(userId, jid) {
    if (!jid) return false
    const cfg = this.getCached(userId)
    const num = String(jid).split('@')[0].replace(/\D/g, '')
    return (cfg.ownerNumbers || []).some((o) => String(o).replace(/\D/g, '') === num)
  }

  getPrefix(userId) {
    return this.getCached(userId).prefix || '.'
  }

  isMaintenance(userId) {
    return !!this.getCached(userId).maintenanceMode
  }

  isPublic(userId) {
    return this.getCached(userId).publicMode !== false
  }

  invalidate(userId) {
    this._cache.delete(userId)
  }
}

const configService = new ConfigService()
export default configService
export { EDITABLE_FIELDS, DEFAULTS }
