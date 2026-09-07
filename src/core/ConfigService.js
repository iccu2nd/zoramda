/**
 * Runtime config service.
 * - Defaults baked in
 * - Overrides from MongoDB (editable via API / .set command)
 * - In-memory cache – never hits DB on message hot path
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
  extra: {},
}

const PUBLIC_FIELDS = [
  'botName',
  'botNumber',
  'prefix',
  'publicMode',
  'menuTitle',
  'welcomeMessage',
  'maintenanceMode',
  'maintenanceMessage',
]

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

class ConfigService {
  constructor() {
    this._cache = { ...DEFAULTS }
    this._loaded = false
    this._loading = null
  }

  async init() {
    if (this._loading) return this._loading
    this._loading = this._loadFromDb()
    try {
      await this._loading
    } finally {
      this._loading = null
    }
    return this._cache
  }

  async _loadFromDb() {
    try {
      let doc = await BotConfig.findOne({ key: 'global' }).lean()
      if (!doc) {
        doc = await BotConfig.create({
          key: 'global',
          ...DEFAULTS,
        })
        doc = doc.toObject ? doc.toObject() : doc
        logger.info('BotConfig seeded from defaults')
      }
      this._merge(doc)
      this._loaded = true
      logger.info({ botName: this._cache.botName, prefix: this._cache.prefix }, 'BotConfig loaded')
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to load BotConfig – using defaults')
      this._cache = { ...DEFAULTS }
      this._loaded = true
    }
  }

  _merge(doc) {
    const next = { ...DEFAULTS }
    for (const key of EDITABLE_FIELDS) {
      if (doc[key] !== undefined && doc[key] !== null) {
        next[key] = doc[key]
      }
    }
    if (!Array.isArray(next.ownerNumbers)) next.ownerNumbers = []
    this._cache = next
  }

  get(key) {
    if (key) return this._cache[key]
    return { ...this._cache }
  }

  getAll() {
    return { ...this._cache }
  }

  getPublic() {
    const out = {}
    for (const k of PUBLIC_FIELDS) out[k] = this._cache[k]
    return out
  }

  async update(partial) {
    const clean = {}
    for (const key of EDITABLE_FIELDS) {
      if (partial[key] !== undefined) {
        clean[key] = partial[key]
      }
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

    const doc = await BotConfig.findOneAndUpdate(
      { key: 'global' },
      { $set: clean },
      { upsert: true, new: true }
    ).lean()

    this._merge(doc)
    logger.info({ keys: Object.keys(clean) }, 'BotConfig updated')
    return this.getAll()
  }

  async refresh() {
    await this._loadFromDb()
    return this.getAll()
  }

  isOwner(jid) {
    if (!jid) return false
    const num = String(jid).split('@')[0].replace(/\D/g, '')
    return (this._cache.ownerNumbers || []).some((o) => String(o).replace(/\D/g, '') === num)
  }

  getPrefix() {
    return this._cache.prefix || '.'
  }

  isMaintenance() {
    return !!this._cache.maintenanceMode
  }

  isPublic() {
    return this._cache.publicMode !== false
  }
}

const configService = new ConfigService()
export default configService
export { PUBLIC_FIELDS, EDITABLE_FIELDS }
