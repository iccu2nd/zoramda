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
  bannedUsers: [],
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
  // Defensive: any caller that hands us a null/undefined doc (a failed
  // upsert, an update that matched nothing, a swallowed error further up)
  // should fall back to defaults instead of throwing "Cannot read
  // properties of null (reading 'botName')".
  if (!doc) return { ...DEFAULTS, pluginResponses: {} }

  const next = { ...DEFAULTS }
  for (const key of EDITABLE_FIELDS) {
    if (doc[key] !== undefined && doc[key] !== null) {
      next[key] = doc[key]
    }
  }
  if (!Array.isArray(next.ownerNumbers)) next.ownerNumbers = []
  next.bannedUsers = Array.isArray(doc.bannedUsers) ? doc.bannedUsers : []
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
    // Step 1: plain read. This is the common case (the doc already exists
    // from a previous run) and it can NEVER hit a duplicate-key/insert
    // error, since it doesn't write anything. Doing this first means an
    // existing user's config load never touches the upsert path below —
    // which is what kept failing for one recurring userId even with the
    // dup-key retry in place, so the safest fix is to just not call it
    // when we don't need to.
    try {
      const existing = await BotConfig.findOne({ userId }).lean()
      if (existing) {
        const cfg = toCache(existing)
        this._cache.set(userId, cfg)
        return cfg
      }
    } catch (err) {
      logger.error({ userId, err: err.message }, 'BotConfig findOne failed, will try create')
    }

    // Step 2: genuinely new user (or the read above failed) — create it.
    try {
      const doc = await BotConfig.findOneAndUpdate(
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
      // Check both err.code and the message text: some driver/server
      // versions wrap this as "Plan executor error during findAndModify ::
      // caused by :: E11000 ..." without surfacing a clean numeric code.
      const isDupKey = err.code === 11000 || /E11000/.test(err.message || '')
      if (isDupKey) {
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
    // Build a dot-notation update so it's atomic on Mongo's side — no more
    // findOne-then-merge-then-write. The old read-merge-write pattern raced
    // with itself under upsert:true (two calls for the same not-yet-existing
    // userId could both try to insert), which surfaced as "Plan executor
    // error during findAndModify :: caused by :: E11000 duplicate key". It
    // also silently dropped concurrent updates to different commands.
    //
    // The route sends `undefined` for a key to mean "reset to default" (see
    // routes/plugins.js). That must become $unset, not $set — handing Mongo
    // a field explicitly set to `undefined` produced a bad update that came
    // back as null, which then crashed on `null.botName` below.
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

    const update = { $setOnInsert: { userId } }
    if (Object.keys(set).length) update.$set = set
    if (Object.keys(unset).length) update.$unset = unset

    let updated
    try {
      updated = await BotConfig.findOneAndUpdate({ userId }, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }).lean()
    } catch (err) {
      const isDupKey = err.code === 11000 || /E11000/.test(err.message || '')
      if (isDupKey) {
        // Lost the upsert race — the doc exists now, retry as a plain update.
        const { $setOnInsert, ...rest } = update
        updated = await BotConfig.findOneAndUpdate({ userId }, rest, { new: true }).lean()
      } else {
        throw err
      }
    }

    // Belt-and-suspenders: if the update still somehow came back empty
    // (shouldn't happen with upsert, but never crash on it), fall back to a
    // plain read rather than caching bad data.
    if (!updated) {
      updated = await BotConfig.findOne({ userId }).lean()
    }

    const cfg = toCache(updated)
    this._cache.set(userId, cfg)
    return cfg.pluginResponses
  }

  /* ——— banned users (blocks all bot commands for that jid) ——— */

  /**
   * $addToSet / $pull instead of read-merge-write — same lesson as
   * updatePluginResponses above: never load an array, mutate it in JS, and
   * write the whole thing back, since concurrent calls silently drop each
   * other's changes. These are atomic on Mongo's side, so two `.ban` calls
   * for different numbers at the same time can't stomp on one another.
   */
  async banUser(userId, jid) {
    const updated = await BotConfig.findOneAndUpdate(
      { userId },
      { $addToSet: { bannedUsers: jid }, $setOnInsert: { userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()
    const cfg = toCache(updated)
    this._cache.set(userId, cfg)
    return cfg.bannedUsers
  }

  async unbanUser(userId, jid) {
    const updated = await BotConfig.findOneAndUpdate(
      { userId },
      { $pull: { bannedUsers: jid } },
      { new: true }
    ).lean()
    const cfg = toCache(updated)
    this._cache.set(userId, cfg)
    return cfg.bannedUsers
  }

  getBannedUsers(userId) {
    return this.getCached(userId).bannedUsers || []
  }

  isBanned(userId, jid) {
    if (!jid) return false
    const num = String(jid).split('@')[0].replace(/\D/g, '')
    return this.getBannedUsers(userId).some((b) => String(b).split('@')[0].replace(/\D/g, '') === num)
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
