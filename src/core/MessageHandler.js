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
import { getContentType, extractMessageContent, downloadMediaMessage } from '@whiskeysockets/baileys'
import logger from '../utils/logger.js'
import {
  extractCommand,
  normalizeJid,
  applyTemplate,
  resolveSenderFromKey,
  findParticipant,
  isParticipantAdmin,
  collectIdentities,
} from '../utils/helpers.js'
import LatencyTracker from './LatencyTracker.js'
import configService from './ConfigService.js'
import {
  heavyQueue,
  tryAcquireSessionSlot,
  releaseSessionSlot,
} from './JobQueue.js'

const PERM_EVERYONE = 'everyone'
const PERM_GROUP = 'group'
const PERM_PRIVATE = 'private'
const PERM_ADMIN = 'admin'
const PERM_BOTADMIN = 'botadmin'
const PERM_OWNER = 'owner'
const PERM_PREMIUM = 'premium'

const MEDIA_TYPES = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'ptvMessage',
]

/** Ambil teks/caption dari sebuah message content + tipenya. Dipakai untuk pesan utama & quoted. */
function extractTextFromContent(content, type) {
  if (!content || !type) return ''
  switch (type) {
    case 'conversation':
      return content.conversation || ''
    case 'extendedTextMessage':
      return content.extendedTextMessage?.text || ''
    case 'imageMessage':
      return content.imageMessage?.caption || ''
    case 'videoMessage':
      return content.videoMessage?.caption || ''
    case 'documentMessage':
      return content.documentMessage?.caption || ''
    case 'buttonsResponseMessage':
      return content.buttonsResponseMessage?.selectedDisplayText || ''
    case 'listResponseMessage':
      return content.listResponseMessage?.title || ''
    case 'templateButtonReplyMessage':
      return content.templateButtonReplyMessage?.selectedDisplayText || ''
    default:
      return ''
  }
}

/** @type {Map<string, { meta: any, exp: number }>} groupJid → cached metadata */
const groupMetaCache = new Map()
/** Short TTL — admin promote/demote must reflect quickly (not multi-minute stale) */
const GROUP_META_TTL_MS = 15 * 1000

/** @type {Map<string, number>} `${sessionId}:${sender}` → last command ts */
const antiSpamMap = new Map()
const ANTI_SPAM_MAX_ENTRIES = 20000

let _lastAntiSpamPrune = 0
function pruneAntiSpam(now) {
  // Only prune periodically or when oversized — avoid O(n) every command
  if (antiSpamMap.size < ANTI_SPAM_MAX_ENTRIES && now - _lastAntiSpamPrune < 30000) return
  _lastAntiSpamPrune = now
  for (const [k, t] of antiSpamMap) {
    if (now - t > 60000) antiSpamMap.delete(k)
  }
}

/**
 * Group metadata from WhatsApp. Permission checks should pass force=true
 * so admin/superadmin is never taken from a long-lived stale cache or DB.
 */
async function getGroupMeta(sock, chatId, force = false) {
  const now = Date.now()
  if (!force) {
    const hit = groupMetaCache.get(chatId)
    if (hit && hit.exp > now) return hit.meta
  }
  const meta = await sock.groupMetadata(chatId)
  groupMetaCache.set(chatId, { meta, exp: now + GROUP_META_TTL_MS })
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

    // Per-session concurrency cap — drop excess under flood (owner still allowed later)
    if (!tryAcquireSessionSlot(sessionId)) return

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

      const isOwner = configService.isOwner(sessionId, m.senderPn || m.sender)

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

      if (!isOwner && configService.isBanned(sessionId, m.senderPn || m.sender)) return
      if (cfg.publicMode === false && !isOwner) return

      // Resolve plugins: try global command map first (O(1)), then custom overrides
      let handlers = this.pluginLoader.getHandlers(m.command)
      if (handlers.length) {
        handlers = handlers.filter((p) => {
          const state = configService.getPluginState(
            sessionId,
            p.file,
            p.permissions || ['everyone']
          )
          if (state.enabled === false) return false
          // Custom command remap claimed this file for another name
          if (state.commands && state.commands.length) return false
          return true
        })
      }
      if (handlers.length === 0) {
        const allPlugins = this.pluginLoader.getAllPlugins()
        const matchedFiles = configService.resolveCommandFiles(sessionId, m.command, allPlugins)
        if (matchedFiles.size) {
          handlers = allPlugins.filter((p) => matchedFiles.has(p.file))
        }
      }
      if (handlers.length === 0) return

      latency.mark('plugin_started')

      // Parallel plugin execution — each isolated; heavy marked plugins detach
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
      releaseSessionSlot(sessionId)
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
    const isGroup = jid?.endsWith('@g.us')
    const resolved = resolveSenderFromKey(raw.key, isGroup)
    const sender = resolved.jid
    const senderLid = resolved.lid
    const senderPn = resolved.pn

    const quotedParticipant =
      contextInfo?.participant || contextInfo?.participantAlt || null
    const quotedMessage = contextInfo?.quotedMessage || null

    let quoted = null
    if (quotedMessage) {
      const qContent = extractMessageContent(quotedMessage) || quotedMessage
      const qType = getContentType(qContent) || getContentType(quotedMessage)
      const qSender = normalizeJid(quotedParticipant)
      const qKey = {
        remoteJid: jid,
        id: contextInfo?.stanzaId,
        fromMe: !!qSender && qSender === normalizeJid(sock.user?.id),
        participant: quotedParticipant,
      }
      const qIsMedia = MEDIA_TYPES.includes(qType)

      quoted = {
        // fields lama — jangan dihapus, plugin lain (delete.js, broadcast.js) masih pakai ini
        sender: qSender,
        message: quotedMessage,
        key: qKey,

        // fields/method baru biar gampang dipakai plugin
        chat: jid,
        fromMe: qKey.fromMe,
        mtype: qType,
        text: extractTextFromContent(qContent, qType),
        isMedia: qIsMedia,
        mediaType: qIsMedia ? qType : null,
        mediaMessage: qIsMedia ? qContent : null,
        mentionedJid: (qContent?.[qType]?.contextInfo?.mentionedJid || []).map(normalizeJid),

        /** m.quoted.download() → Buffer media dari pesan yang di-quote */
        download: async () => {
          if (!qIsMedia) throw new Error('Pesan yang di-quote bukan media')
          return downloadMediaMessage(
            { key: qKey, message: quotedMessage },
            'buffer',
            {},
            { reuploadRequest: sock.updateMediaMessage }
          )
        },

        /** m.quoted.reply('teks') → balas dengan mengutip pesan yang di-quote */
        reply: async (content) => {
          const payload = typeof content === 'string' ? { text: content } : content
          return sock.sendMessage(jid, payload, { quoted: { key: qKey, message: quotedMessage } })
        },

        /** m.quoted.delete() → hapus pesan yang di-quote (perlu pesan itu milik bot) */
        delete: async () => sock.sendMessage(jid, { delete: qKey }),
      }
    }

    const reply = async (content, quotedMsg = raw) => {
      if (latency) latency.mark('reply_started')
      try {
        const payload = typeof content === 'string' ? { text: content } : content
        return await sock.sendMessage(jid, payload, { quoted: quotedMsg })
      } finally {
        if (latency) latency.mark('reply_finished')
      }
    }

    // m.react('👍') — reaksi cepat ke pesan yang sedang diproses
    const react = async (emoji) => {
      return await sock.sendMessage(jid, { react: { text: emoji || '', key: raw.key } })
    }

    return {
      raw,
      key: raw.key,
      chat: jid,
      sender: sender || normalizeJid(raw.key.participant || raw.key.remoteJid),
      senderLid,
      senderPn,
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
      react,
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
        return isOwner || configService.isPremium(sessionId, m.senderPn || m.sender)
      case PERM_ADMIN: {
        if (!m.isGroup) return false
        if (isOwner) return true
        try {
          // force=true → live metadata from WA (admin/superadmin source of truth)
          const meta =
            metaBag.meta || (metaBag.meta = await getGroupMeta(sock, m.chat, true))
          const p = findParticipant(meta.participants || [], m.sender, {
            lid: m.senderLid,
            pn: m.senderPn,
          })
          return isParticipantAdmin(p)
        } catch {
          return false
        }
      }
      case PERM_BOTADMIN: {
        if (!m.isGroup) return false
        try {
          const meta =
            metaBag.meta || (metaBag.meta = await getGroupMeta(sock, m.chat, true))
          const botId = sock.user?.id
          const botLid = sock.user?.lid || null
          const p = findParticipant(meta.participants || [], botId, {
            lid: botLid ? normalizeJid(botLid) : null,
            pn: normalizeJid(botId),
          })
          return isParticipantAdmin(p)
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

    // Sync-only perms first (no I/O) — fail fast without waiting group metadata
    const needsMeta = []
    for (const perm of effective) {
      if (perm === PERM_ADMIN || perm === PERM_BOTADMIN) {
        needsMeta.push(perm)
        continue
      }
      if (perm === PERM_GROUP && !m.isGroup) return { allowed: false, failed: perm }
      if (perm === PERM_PRIVATE && m.isGroup) return { allowed: false, failed: perm }
      if (perm === PERM_OWNER && !isOwner) return { allowed: false, failed: perm }
      if (perm === PERM_PREMIUM) {
        if (!isOwner && !configService.isPremium(sessionId, m.senderPn || m.sender)) {
          return { allowed: false, failed: perm }
        }
      }
    }

    if (needsMeta.length === 0) return { allowed: true }

    const metaBag = {}
    // Parallel group-meta checks (admin + botadmin share one fetch via metaBag)
    const results = await Promise.all(
      needsMeta.map((perm) => this._checkOnePermission(perm, m, sock, isOwner, metaBag, sessionId))
    )
    for (let i = 0; i < needsMeta.length; i++) {
      if (!results[i]) return { allowed: false, failed: needsMeta[i] }
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
      const isPremiumUser = configService.isPremium(sessionId, m.senderPn || m.sender)
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
      isPremium: isOwner || configService.isPremium(sessionId, m.senderPn || m.sender),
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

    // Heavy plugins: bounded global queue + non-blocking for light siblings
    if (plugin.handler?.heavy) {
      heavyQueue.push(async () => {
        try {
          await plugin.handler(m, ctx)
          latency.mark('plugin_finished')
        } catch (err) {
          logger.error(
            { sessionId, file: plugin.file, err: err?.message },
            'Heavy plugin error'
          )
        }
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
