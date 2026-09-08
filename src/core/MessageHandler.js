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
const PERM_PREMIUM = 'premium'

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

      // Resolve handlers: global command map + per-session custom command aliases
      const allPlugins = this.pluginLoader.getAllPlugins()
      const matchedFiles = configService.resolveCommandFiles(sessionId, m.command, allPlugins)
      let handlers = allPlugins.filter((p) => matchedFiles.has(p.file))
      // Fallback to global registry only when no session mapping matched
      if (handlers.length === 0) {
        const global = this.pluginLoader.getHandlers(m.command) || []
        handlers = global.filter((p) => {
          const state = configService.getPluginState(
            sessionId,
            p.file,
            p.permissions || ['everyone']
          )
          // skip disabled; if custom commands set, defaults no longer match via fallback
          if (state.enabled === false) return false
          if (state.commands && state.commands.length) return false
          return true
        })
      }
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
   * Check a single permission flag.
   */
  async _checkOnePermission(permission, m, sock, isOwner, groupMetaCache, sessionId) {
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
          const meta = groupMetaCache.meta || (groupMetaCache.meta = await sock.groupMetadata(m.chat))
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
          const meta = groupMetaCache.meta || (groupMetaCache.meta = await sock.groupMetadata(m.chat))
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

  /**
   * AND-combine all permissions in the list.
   * Example: ['admin', 'botadmin'] → user must be admin AND bot must be admin.
   * 'everyone' alone always passes; if mixed with others, others still apply.
   * Returns { allowed, failed } — failed is the first permission that didn't pass.
   */
  async _checkPermissions(permissions, m, sock, isOwner, sessionId) {
    const list = Array.isArray(permissions) ? permissions : [permissions || 'everyone']
    // If only everyone (or empty), allow
    const effective = list.filter((p) => p && p !== PERM_EVERYONE)
    if (effective.length === 0) return { allowed: true }

    const cache = {}
    for (const perm of effective) {
      const ok = await this._checkOnePermission(perm, m, sock, isOwner, cache, sessionId)
      if (!ok) return { allowed: false, failed: perm }
    }
    return { allowed: true }
  }

  /**
   * Pick the custom denial message for whichever permission blocked the command.
   */
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

  async _runPlugin(plugin, m, sock, sessionId, userId, latency, isOwner) {
    // Default permissions from plugin metadata (string or array), overridden per-session
    const rawDefault = plugin.handler.permission ?? plugin.permission ?? 'everyone'
    const defaultPerms = Array.isArray(rawDefault)
      ? rawDefault.map((p) => String(p).toLowerCase())
      : [String(rawDefault).toLowerCase()]

    const state = configService.getPluginState(sessionId, plugin.file, defaultPerms)

    // Toggle OFF → skip entirely (no reply, no error)
    if (!state.enabled) return

    // Permission gate — ALL selected permissions must pass (AND)
    const permResult = await this._checkPermissions(state.permissions, m, sock, isOwner, sessionId)
    const botCfg = configService.getCached(sessionId)
    if (!permResult.allowed) {
      const msg = this._permissionMessage(permResult.failed, botCfg)
      if (msg) await m.reply(msg)
      return
    }

    // Limit gate — skip for owners; premium users bypass only if premiumUnlimited is on
    if (configService.isLimitEnabled(sessionId) && !isOwner) {
      const isPremiumUser = configService.isPremium(sessionId, m.sender)
      const bypassLimit = isPremiumUser && botCfg.premiumUnlimited
      if (!bypassLimit) {
        const result = await configService.consumeLimit(sessionId, userId, m.sender)
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
    await plugin.handler(m, ctx)
    latency.mark('plugin_finished')
  }
}

export default MessageHandler
