/**
 * Low-latency message processing pipeline.
 *
 * WhatsApp → messages.upsert → parser → command detect → plugin lookup → execute → reply
 *
 * Design goals:
 * - First message (e.g. .menu) replies immediately
 * - Heavy tasks never block light commands or other sessions
 * - No global queue / mutex
 * - Per-message latency tracking
 * - Runtime config from ConfigService (editable via web/API)
 */
import { getContentType, extractMessageContent } from '@whiskeysockets/baileys'
import logger from '../utils/logger.js'
import { extractCommand, normalizeJid, applyTemplate } from '../utils/helpers.js'
import LatencyTracker from './LatencyTracker.js'
import configService from './ConfigService.js'

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
   * @param {string} userId owner of the session – scopes config & plugin responses
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

      // Always read live per-user config from cache (no DB hit)
      const prefix = configService.getPrefix(userId)
      const m = this._parseMessage(raw, sock, prefix)
      if (!m) return

      latency.mark('command_detected')

      if (!m.command) return

      // Maintenance mode – only owners can use commands
      const isOwner = configService.isOwner(userId, m.sender)
      if (configService.isMaintenance(userId) && !isOwner) {
        const cfg = configService.getCached(userId)
        await m.reply(cfg.maintenanceMessage || 'Bot sedang maintenance.')
        return
      }

      // Banned users are silently ignored — no reply, so a banned user
      // can't tell whether the bot is even seeing their messages.
      if (!isOwner && configService.isBanned(userId, m.sender)) {
        return
      }

      // Public mode off – only owners
      if (!configService.isPublic(userId) && !isOwner) {
        return // silent ignore for non-owners
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

    // Quoted (replied-to) message, if any — used by admin commands like
    // .ban / .kick / .promote / .delete to target "whoever I replied to"
    // without needing a raw phone number.
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
      sock.reply = async (chatId, content, quoted) => {
        const payload = typeof content === 'string' ? { text: content } : content
        return sock.sendMessage(chatId, payload, { quoted: quoted?.key ? quoted : quoted })
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
      reply: async (content, quoted = raw) => {
        const payload = typeof content === 'string' ? { text: content } : content
        return sock.sendMessage(jid, payload, { quoted })
      },
    }
  }

  async _runPlugin(plugin, m, sock, sessionId, userId, latency, isOwner) {
    const botCfg = configService.getCached(userId)

    // Merge the plugin's declared default responses with this user's overrides,
    // then resolve {placeholder} tokens against config values.
    const defaults = plugin.handler.responses || {}
    const overrides = configService.getPluginResponses(userId, plugin.commands[0])
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
      // Live per-user bot config for plugins
      botConfig: botCfg,
      botName: botCfg.botName,
      responses,
      config: {
        get: (key) => (key ? botCfg[key] : { ...botCfg }),
        getAll: () => ({ ...botCfg }),
        update: (partial) => configService.update(userId, partial),
        isOwner: (jid) => configService.isOwner(userId, jid),
        ban: (jid) => configService.banUser(userId, jid),
        unban: (jid) => configService.unbanUser(userId, jid),
        isBanned: (jid) => configService.isBanned(userId, jid),
        getBannedUsers: () => configService.getBannedUsers(userId),
      },
    }

    latency.mark('plugin_exec')
    await plugin.handler(m, ctx)
    latency.mark('plugin_finished')
  }
}

export default MessageHandler
