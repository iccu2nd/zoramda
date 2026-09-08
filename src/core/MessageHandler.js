/**
 * Low-latency message processing pipeline.
 *
 * WhatsApp → messages.upsert → parser → command detect → plugin lookup →
 * enabled? → permission? → execute → reply
 *
 * Design goals:
 * - First message (e.g. .menu) replies immediately
 * - Heavy tasks never block light commands or other sessions
 * - No global queue / mutex
 * - Per-session config, plugin toggle, and permission isolation
 * - Group metadata + anti-spam cached in memory
 */
import { getContentType, extractMessageContent } from '@whiskeysockets/baileys'
import logger from '../utils/logger.js'
import { extractCommand, normalizeJid, applyTemplate } from '../utils/helpers.js'
import LatencyTracker from './LatencyTracker.js'
import configService from './ConfigService.js'

const PERM_EVERYONE = 'everyone'
const PERM_GROUP = 'group'
const PERM_PRIVATE = 'private'
const PERM_ADMIN = 'admin'
const PERM_BOTADMIN = 'botadmin'
const PERM_OWNER = 'owner'
const PERM_PREMIUM = 'premium'

/** @type {Map<string, { meta: any, exp: number }>} groupJid → cached metadata */
const groupMetaCache = new Map()
const GROUP_META_TTL_MS = 3 * 60 * 1000

/** @type {Map<string, number>} `${sessionId}:${sender}` → last command ts */
const antiSpamMap = new Map()
const ANTI_SPAM_MAX_ENTRIES = 20000

function pruneAntiSpam(now) {
  if (antiSpamMap.size < ANTI_SPAM_MAX_ENTRIES) return
  for (const [k, t] of antiSpamMap) {
    if (now - t > 60000) antiSpamMap.delete(k)
  }
}

async function getGroupMeta(sock, chatId) {
  const hit = groupMetaCache.get(chatId)
  const now = Date.now()
  if (hit && hit.exp > now) return hit.meta
  const meta = await sock.groupMetadata(chatId)
  groupMetaCache.set(chatId, { meta, exp: now + GROUP_META_TTL_MS })
  // soft bound cache size
  if (groupMetaCache.size > 500) {
    const first = groupMetaCache.keys().next().value
    if (first) groupMetaCache.delete(first)
  }
  return meta
}

export class MessageHandler {
  /**
   * @param {import('./PluginLoader.js').PluginLoader} pluginLoader
   */
  constructor(pluginLoader) {
    this.pluginLoader = pluginLoader
  }

  /**
   * Entry point from ConnectionManager.
   * Must return quickly – never await long-running work here.
   */
  async handle(sessionId, userId, sock, upsert) {
    if (!upsert || upsert.type !== 'notify') return

    const messages = upsert.messages || []
    for (const raw of messages) {
      // fire-and-forget per message — never block the upsert loop
      this._processOne(sessionId, userId, sock, raw).catch((err) => {
        logger.error({ sessionId, err: err?.message || String(err) }, 'Unhandled message process error')
      })
    }
  }

  async _processOne(sessionId, userId, sock, raw) {
    if (!raw?.message || raw.key?.fromMe) return
    if (raw.key?.remoteJid === 'status@broadcast') return

    const latency = new LatencyTracker(raw.key?.id, sessionId)

    try {
      latency.mark('handler_started')

      // Fast path: config from memory only
      const cfg = configService.getCached(sessionId)
      const prefix = cfg.prefix || '.'

      // Cheap pre-check: extract text early; skip non-commands before full parse
      const quickText = _quickText(raw)
      if (!quickText) return
      // If text doesn't start with prefix, skip (no command)
      if (!quickText.startsWith(prefix)) return

      const m = this._parseMessage(raw, sock, prefix, latency)
      if (!m || !m.command) return

      latency.mark('command_detected')

      const isOwner = configService.isOwner(sessionId, m.sender)

      // Anti-spam (memory only, no DB)
      if (cfg.antiSpam && !isOwner) {
        const gap = Math.max(0, cfg.antiSpamCooldownMs || 0)
        if (gap > 0) {
          const key = `${sessionId}:${m.sender}`
          const now = Date.now()
          const last = antiSpamMap.get(key) || 0
          if (now - last < gap) return
          antiSpamMap.set(key, now)
          pruneAntiSpam(now)
        }
      }

      // Presence / read — never await (must not delay reply)
      if (cfg.readMessages) {
        sock.readMessages([raw.key]).catch(() => {})
      }
      if (cfg.sendTyping) {
        sock.sendPresenceUpdate('composing', m.chat).catch(() => {})
      } else if (cfg.sendRecording) {
        sock.sendPresenceUpdate('recording', m.chat).catch(() => {})
      }

      if (cfg.maintenanceMode && !isOwner) {
        await m.reply(cfg.maintenanceMessage || 'Bot sedang maintenance.')
        return
      }

      if (!isOwner && configService.isBanned(sessionId, m.sender)) return
      if (cfg.publicMode === false && !isOwner) return

      // Resolve plugins (custom commands + defaults)
      const allPlugins = this.pluginLoader.getAllPlugins()
      const matchedFiles = configService.resolveCommandFiles(sessionId, m.command, allPlugins)
      let handlers = allPlugins.filter((p) => matchedFiles.has(p.file))
      if (handlers.length === 0) {
        const global = this.pluginLoader.getHandlers(m.command) || []
        handlers = global.filter((p) => {
          const state = configService.getPluginState(
            sessionId,
            p.file,
            p.permissions || ['everyone']
          )
          if (state.enabled === false) return false
          if (state.commands && state.commands.length) return false
          return true
        })
      }
      if (handlers.length === 0) return

      latency.mark('plugin_started')

      // Light plugins run in parallel; heavy plugins also parallel but isolated via catch
      await Promise.all(
        handlers.map((plugin) =>
          this._runPlugin(plugin, m, sock, sessionId, userId, latency, isOwner, cfg).catch(
            (err) => {
              logger.error(
                { sessionId, command: m.command, file: plugin.file, err: err?.message },
                'Plugin execution error'
              )
            }
          )
        )
      )
    } finally {
      latency.finish()
    }
  }

  _parseMessage(raw, sock, prefix, latency) {
    const content = extractMessageContent(raw.message) || raw.message
    const type = getContentType(content) || getContentType(raw.message)

    let text = ''
    let contextInfo = null
    if (type === 'conversation') text = content.conversation || ''
    else if (type === 'extendedTextMessage') {
      text = content.extendedTextMessage?.text || ''
      contextInfo = content.extendedTextMessage?.contextInfo || null
    } else if (type === 'imageMessage') {
      text = content.imageMessage?.caption || ''
      contextInfo = content.imageMessage?.contextInfo || null
    } else if (type === 'videoMessage') {
      text = content.videoMessage?.caption || ''
      contextInfo = content.videoMessage?.contextInfo || null
    } else if (type === 'documentMessage') {
      text = content.documentMessage?.caption || ''
      contextInfo = content.documentMessage?.contextInfo || null
    } else if (type === 'buttonsResponseMessage')
      text = content.buttonsResponseMessage?.selectedDisplayText || ''
    else if (type === 'listResponseMessage')
      text = content.listResponseMessage?.title || ''
    else if (type === 'templateButtonReplyMessage')
      text = content.templateButtonReplyMessage?.selectedDisplayText || ''

    text = (text || '').trim()
    if (!text) return null

    const parsed = extractCommand(text, prefix)
    const jid = raw.key.remoteJid
    const sender = raw.key.participant || raw.key.remoteJid
    const isGroup = jid?.endsWith('@g.us')

    const quotedParticipant = contextInfo?.participant || null
    const quotedMessage = contextInfo?.quotedMessage || null
    const quoted = quotedMessage
      ? {
          sender: normalizeJid(quotedParticipant),
          message: quotedMessage,
          key: {
            remoteJid: jid,
            id: contextInfo?.stanzaId,
            fromMe: normalizeJid(quotedParticipant) === normalizeJid(sock.user?.id),
            participant: quotedParticipant,
          },
        }
      : null

    const reply = async (content, quotedMsg = raw) => {
      if (latency) latency.mark('reply_started')
      try {
        const payload = typeof content === 'string' ? { text: content } : content
        return await sock.sendMessage(jid, payload, { quoted: quotedMsg })
      } finally {
        if (latency) latency.mark('reply_finished')
      }
    }

    return {
      raw,
      key: raw.key,
      chat: jid,
      sender: normalizeJid(sender),
      fromMe: !!raw.key.fromMe,
      isGroup,
      text,
      command: parsed?.command || null,
      args: parsed?.args || [],
      body: parsed?.text || '',
      usedPrefix: prefix,
      type,
      mentionedJid: contextInfo?.mentionedJid || [],
      quoted,
      pushName: raw.pushName || '',
      timestamp: raw.messageTimestamp,
      reply,
    }
  }

  async _checkOnePermission(permission, m, sock, isOwner, metaBag, sessionId) {
    switch (permission) {
      case PERM_EVERYONE:
        return true
      case PERM_GROUP:
        return !!m.isGroup
      case PERM_PRIVATE:
        return !m.isGroup
      case PERM_OWNER:
        return isOwner
      case PERM_PREMIUM:
        return isOwner || configService.isPremium(sessionId, m.sender)
      case PERM_ADMIN: {
        if (!m.isGroup) return false
        if (isOwner) return true
        try {
          const meta = metaBag.meta || (metaBag.meta = await getGroupMeta(sock, m.chat))
          const participant = meta.participants?.find(
            (p) => normalizeJid(p.id) === m.sender
          )
          return !!(participant?.admin === 'admin' || participant?.admin === 'superadmin')
        } catch {
          return false
        }
      }
      case PERM_BOTADMIN: {
        if (!m.isGroup) return false
        try {
          const meta = metaBag.meta || (metaBag.meta = await getGroupMeta(sock, m.chat))
          const botId = normalizeJid(sock.user?.id)
          const botPart = meta.participants?.find((p) => normalizeJid(p.id) === botId)
          return !!(botPart?.admin === 'admin' || botPart?.admin === 'superadmin')
        } catch {
          return false
        }
      }
      default:
        return true
    }
  }

  async _checkPermissions(permissions, m, sock, isOwner, sessionId) {
    const list = Array.isArray(permissions) ? permissions : [permissions || 'everyone']
    const effective = list.filter((p) => p && p !== PERM_EVERYONE)
    if (effective.length === 0) return { allowed: true }

    const metaBag = {}
    for (const perm of effective) {
      const ok = await this._checkOnePermission(perm, m, sock, isOwner, metaBag, sessionId)
      if (!ok) return { allowed: false, failed: perm }
    }
    return { allowed: true }
  }

  _permissionMessage(failed, cfg) {
    switch (failed) {
      case PERM_OWNER:
        return cfg.ownerOnlyMessage || 'Perintah ini hanya untuk owner.'
      case PERM_ADMIN:
      case PERM_BOTADMIN:
        return cfg.adminOnlyMessage || 'Perintah ini hanya untuk admin grup.'
      case PERM_GROUP:
        return cfg.groupOnlyMessage || 'Perintah ini hanya bisa dipakai di dalam grup.'
      case PERM_PRIVATE:
        return cfg.privateOnlyMessage || 'Perintah ini hanya bisa dipakai lewat chat pribadi.'
      case PERM_PREMIUM:
        return cfg.premiumOnlyMessage || 'Perintah ini khusus untuk member premium.'
      default:
        return null
    }
  }

  async _runPlugin(plugin, m, sock, sessionId, userId, latency, isOwner, botCfg) {
    const rawDefault = plugin.handler.permission ?? plugin.permission ?? 'everyone'
    const defaultPerms = Array.isArray(rawDefault)
      ? rawDefault.map((p) => String(p).toLowerCase())
      : [String(rawDefault).toLowerCase()]

    const state = configService.getPluginState(sessionId, plugin.file, defaultPerms)
    if (!state.enabled) return

    const permResult = await this._checkPermissions(state.permissions, m, sock, isOwner, sessionId)
    if (!permResult.allowed) {
      const msg = this._permissionMessage(permResult.failed, botCfg)
      if (msg) await m.reply(msg)
      return
    }

    // Limit — memory-first (no await DB)
    if (configService.isLimitEnabled(sessionId) && !isOwner) {
      const isPremiumUser = configService.isPremium(sessionId, m.sender)
      const bypassLimit = isPremiumUser && botCfg.premiumUnlimited
      if (!bypassLimit) {
        const result = configService.consumeLimit(sessionId, userId, m.sender)
        if (!result.allowed) {
          await m.reply(botCfg.limitMessage || 'Limit kamu sudah habis.')
          return
        }
      }
    }

    const defaults = plugin.handler.responses || {}
    const overrides = configService.getPluginResponses(sessionId, plugin.commands[0])
    const vars = {
      botName: botCfg.botName,
      prefix: m.usedPrefix,
      ownerName: botCfg.ownerName,
      packName: botCfg.packName,
      author: botCfg.author,
    }
    const responses = {}
    for (const key of Object.keys(defaults)) {
      const raw = overrides[key] !== undefined ? overrides[key] : defaults[key]
      responses[key] = applyTemplate(raw, vars)
    }

    const ctx = {
      conn: sock,
      text: m.body,
      args: m.args,
      usedPrefix: m.usedPrefix,
      command: m.command,
      sessionId,
      userId,
      isOwner,
      isPremium: isOwner || configService.isPremium(sessionId, m.sender),
      plugins: this.pluginLoader,
      botConfig: botCfg,
      botName: botCfg.botName,
      responses,
      config: {
        get: (key) => (key ? botCfg[key] : { ...botCfg }),
        getAll: () => ({ ...botCfg }),
        update: (partial) => configService.update(sessionId, userId, partial),
        isOwner: (jid) => configService.isOwner(sessionId, jid),
        ban: (jid) => configService.banUser(sessionId, userId, jid),
        unban: (jid) => configService.unbanUser(sessionId, userId, jid),
        isBanned: (jid) => configService.isBanned(sessionId, jid),
        getBannedUsers: () => configService.getBannedUsers(sessionId),
        isPremium: (jid) => configService.isPremium(sessionId, jid),
        addPremium: (jid) => configService.addPremium(sessionId, userId, jid),
        removePremium: (jid) => configService.removePremium(sessionId, userId, jid),
        getPremiumUsers: () => configService.getPremiumUsers(sessionId),
        getUserLimit: (jid) => configService.getUserLimit(sessionId, jid),
        setUserLimit: (jid, amount) => configService.setUserLimit(sessionId, userId, jid, amount),
      },
    }

    latency.mark('plugin_exec')

    // Heavy plugins: run detached so they never stall sibling light handlers
    // on the same message (rare multi-match). Still awaited at Promise.all level
    // only if not marked heavy.
    if (plugin.handler?.heavy) {
      setImmediate(() => {
        Promise.resolve(plugin.handler(m, ctx))
          .then(() => latency.mark('plugin_finished'))
          .catch((err) => {
            logger.error(
              { sessionId, file: plugin.file, err: err?.message },
              'Heavy plugin error'
            )
          })
      })
      return
    }

    await plugin.handler(m, ctx)
    latency.mark('plugin_finished')
  }
}

/** Extract plain text from a raw WA message without full parse — for prefix gate. */
function _quickText(raw) {
  try {
    const msg = raw.message
    if (!msg) return ''
    if (msg.conversation) return String(msg.conversation).trim()
    if (msg.extendedTextMessage?.text) return String(msg.extendedTextMessage.text).trim()
    if (msg.imageMessage?.caption) return String(msg.imageMessage.caption).trim()
    if (msg.videoMessage?.caption) return String(msg.videoMessage.caption).trim()
    if (msg.documentMessage?.caption) return String(msg.documentMessage.caption).trim()
    // unwrap ephemeral / viewOnce
    const inner =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.documentWithCaptionMessage?.message
    if (inner) {
      if (inner.conversation) return String(inner.conversation).trim()
      if (inner.extendedTextMessage?.text) return String(inner.extendedTextMessage.text).trim()
      if (inner.imageMessage?.caption) return String(inner.imageMessage.caption).trim()
    }
    return ''
  } catch {
    return ''
  }
}

export default MessageHandler
