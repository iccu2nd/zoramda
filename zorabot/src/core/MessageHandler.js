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
      this._processOne(sessionId, userId, sock, raw).catch((err) => {
        logger.error({ sessionId, err: err.message }, 'Unhandled message process error')
      })
    }
  }

  async _processOne(sessionId, userId, sock, raw) {
    if (!raw?.message || raw.key?.fromMe) return
    if (raw.key?.remoteJid === 'status@broadcast') return

    const latency = new LatencyTracker(raw.key?.id, sessionId)

    try {
      latency.mark('handler_started')

      // Always read live per-session config from cache (no DB hit)
      const prefix = configService.getPrefix(sessionId)
      const m = this._parseMessage(raw, sock, prefix)
      if (!m) return

      latency.mark('command_detected')

      if (!m.command) return

      const isOwner = configService.isOwner(sessionId, m.sender)

      // Optional read receipt / presence (non-blocking)
      const cfg = configService.getCached(sessionId)
      if (cfg.readMessages) {
        sock.readMessages([raw.key]).catch(() => {})
      }
      if (cfg.sendTyping) {
        sock.sendPresenceUpdate('composing', m.chat).catch(() => {})
      } else if (cfg.sendRecording) {
        sock.sendPresenceUpdate('recording', m.chat).catch(() => {})
      }

      // Maintenance mode – only owners can use commands
      if (configService.isMaintenance(sessionId) && !isOwner) {
        await m.reply(cfg.maintenanceMessage || 'Bot sedang maintenance.')
        return
      }

      // Banned users are silently ignored
      if (!isOwner && configService.isBanned(sessionId, m.sender)) {
        return
      }

      // Public mode off – only owners
      if (!configService.isPublic(sessionId) && !isOwner) {
        return
      }

      const handlers = this.pluginLoader.getHandlers(m.command)
      if (handlers.length === 0) return

      latency.mark('plugin_started')

      await Promise.all(
        handlers.map((plugin) =>
          this._runPlugin(plugin, m, sock, sessionId, userId, latency, isOwner).catch((err) => {
            logger.error(
              { sessionId, command: m.command, file: plugin.file, err: err.message },
              'Plugin execution error'
            )
          })
        )
      )
    } finally {
      latency.finish()
    }
  }

  _parseMessage(raw, sock, prefix) {
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

    if (!sock.reply) {
      sock.reply = async (chatId, content, quotedMsg) => {
        const payload = typeof content === 'string' ? { text: content } : content
        return sock.sendMessage(chatId, payload, {
          quoted: quotedMsg?.key ? quotedMsg : quotedMsg,
        })
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
      reply: async (content, quotedMsg = raw) => {
        const payload = typeof content === 'string' ? { text: content } : content
        return sock.sendMessage(jid, payload, { quoted: quotedMsg })
      },
    }
  }

  /**
   * Check permission for this session's plugin state.
   * Returns true if allowed.
   */
  async _checkPermission(permission, m, sock, isOwner) {
    switch (permission) {
      case PERM_EVERYONE:
        return true
      case PERM_GROUP:
        return !!m.isGroup
      case PERM_PRIVATE:
        return !m.isGroup
      case PERM_OWNER:
        return isOwner
      case PERM_ADMIN: {
        if (!m.isGroup) return false
        if (isOwner) return true
        try {
          const meta = await sock.groupMetadata(m.chat)
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
          const meta = await sock.groupMetadata(m.chat)
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

  async _runPlugin(plugin, m, sock, sessionId, userId, latency, isOwner) {
    // Default permission from plugin metadata, overridden by per-session state
    const defaultPerm =
      (plugin.handler.permission && String(plugin.handler.permission).toLowerCase()) ||
      'everyone'

    const state = configService.getPluginState(sessionId, plugin.file, defaultPerm)

    // Toggle OFF → skip entirely (no reply, no error)
    if (!state.enabled) return

    // Permission gate
    const allowed = await this._checkPermission(state.permission, m, sock, isOwner)
    if (!allowed) {
      if (state.permission === PERM_OWNER) {
        const cfg = configService.getCached(sessionId)
        await m.reply(cfg.ownerOnlyMessage || 'Perintah ini hanya untuk owner.')
      }
      return
    }

    const botCfg = configService.getCached(sessionId)

    const defaults = plugin.handler.responses || {}
    const overrides = configService.getPluginResponses(sessionId, plugin.commands[0])
    const vars = {
      botName: botCfg.botName,
      prefix: m.usedPrefix,
      ownerName: botCfg.ownerName,
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
      },
    }

    latency.mark('plugin_exec')
    await plugin.handler(m, ctx)
    latency.mark('plugin_finished')
  }
}

export default MessageHandler
