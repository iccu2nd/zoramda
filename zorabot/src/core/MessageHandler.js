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
import { extractCommand, normalizeJid } from '../utils/helpers.js'
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
   */
  async handle(sessionId, sock, upsert) {
    if (!upsert || upsert.type !== 'notify') return

    const messages = upsert.messages || []
    for (const raw of messages) {
      this._processOne(sessionId, sock, raw).catch((err) => {
        logger.error({ sessionId, err: err.message }, 'Unhandled message process error')
      })
    }
  }

  async _processOne(sessionId, sock, raw) {
    if (!raw?.message || raw.key?.fromMe) return
    if (raw.key?.remoteJid === 'status@broadcast') return

    const latency = new LatencyTracker(raw.key?.id, sessionId)

    try {
      latency.mark('handler_started')

      // Always read live config from cache (no DB hit)
      const prefix = configService.getPrefix()
      const m = this._parseMessage(raw, sock, prefix)
      if (!m) return

      latency.mark('command_detected')

      if (!m.command) return

      // Maintenance mode – only owners can use commands
      const isOwner = configService.isOwner(m.sender)
      if (configService.isMaintenance() && !isOwner) {
        await m.reply(configService.get('maintenanceMessage') || 'Bot sedang maintenance.')
        return
      }

      // Public mode off – only owners
      if (!configService.isPublic() && !isOwner) {
        return // silent ignore for non-owners
      }

      const handlers = this.pluginLoader.getHandlers(m.command)
      if (handlers.length === 0) return

      latency.mark('plugin_started')

      await Promise.all(
        handlers.map((plugin) =>
          this._runPlugin(plugin, m, sock, sessionId, latency, isOwner).catch((err) => {
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
    if (type === 'conversation') text = content.conversation || ''
    else if (type === 'extendedTextMessage') text = content.extendedTextMessage?.text || ''
    else if (type === 'imageMessage') text = content.imageMessage?.caption || ''
    else if (type === 'videoMessage') text = content.videoMessage?.caption || ''
    else if (type === 'documentMessage') text = content.documentMessage?.caption || ''
    else if (type === 'buttonsResponseMessage')
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
      pushName: raw.pushName || '',
      timestamp: raw.messageTimestamp,
      reply: async (content, quoted = raw) => {
        const payload = typeof content === 'string' ? { text: content } : content
        return sock.sendMessage(jid, payload, { quoted })
      },
    }
  }

  async _runPlugin(plugin, m, sock, sessionId, latency, isOwner) {
    const botCfg = configService.getAll()
    const ctx = {
      conn: sock,
      text: m.body,
      args: m.args,
      usedPrefix: m.usedPrefix,
      command: m.command,
      sessionId,
      isOwner,
      plugins: this.pluginLoader,
      // Live bot config for plugins
      botConfig: botCfg,
      botName: botCfg.botName,
      config: configService,
    }

    latency.mark('plugin_exec')
    await plugin.handler(m, ctx)
    latency.mark('plugin_finished')
  }
}

export default MessageHandler
