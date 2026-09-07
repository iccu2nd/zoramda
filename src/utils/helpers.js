import { jidNormalizedUser } from '@whiskeysockets/baileys'

export function normalizeJid(jid) {
  if (!jid) return null
  try {
    return jidNormalizedUser(jid)
  } catch {
    return jid
  }
}

export function isOwner(jid, ownerNumbers = []) {
  if (!jid) return false
  const num = jid.split('@')[0].replace(/\D/g, '')
  return ownerNumbers.some(o => o.replace(/\D/g, '') === num)
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str)
  } catch {
    return fallback
  }
}

export function extractCommand(text, prefix) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed.startsWith(prefix)) return null
  const withoutPrefix = trimmed.slice(prefix.length).trim()
  if (!withoutPrefix) return null
  const [cmd, ...args] = withoutPrefix.split(/\s+/)
  return {
    command: cmd.toLowerCase(),
    args,
    text: args.join(' '),
    full: withoutPrefix,
  }
}

export function applyTemplate(str, vars = {}) {
  if (typeof str !== 'string') return str
  return str.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined ? vars[key] : match))
}

export function serializeError(err) {
  if (!err) return null
  return {
    message: err.message || String(err),
    name: err.name,
    code: err.code || err.output?.statusCode,
  }
}

/**
 * Turn a raw number/text arg into a WhatsApp JID.
 * Accepts "6281234567890", "0812-3456-7890", "@6281234567890", etc.
 */
export function numberToJid(text) {
  if (!text) return null
  const digits = String(text).replace(/\D/g, '')
  if (!digits) return null
  return `${digits}@s.whatsapp.net`
}

/**
 * Resolve the target user(s) for an admin command (ban, kick, promote, ...)
 * in priority order: @mentions in the message, the participant of a quoted
 * (replied-to) message, then a plain number passed as the first argument.
 * Returns a de-duplicated array of normalized JIDs (may be empty).
 */
export function resolveTargets(m, args = []) {
  const targets = []
  if (Array.isArray(m.mentionedJid)) {
    for (const jid of m.mentionedJid) {
      const n = normalizeJid(jid)
      if (n) targets.push(n)
    }
  }
  if (targets.length === 0 && m.quoted?.sender) {
    const n = normalizeJid(m.quoted.sender)
    if (n) targets.push(n)
  }
  if (targets.length === 0 && args[0]) {
    const jid = numberToJid(args[0])
    if (jid) targets.push(normalizeJid(jid))
  }
  return [...new Set(targets.filter(Boolean))]
}

/**
 * Fetch group metadata and answer the two questions every group-admin
 * command needs: is the sender a group admin, and is the bot itself a
 * group admin (WhatsApp silently ignores kick/promote/demote/etc if the
 * bot isn't one, so we check up front and give a clear error instead).
 */
export async function checkGroupAdmin(sock, chat, senderJid) {
  const metadata = await sock.groupMetadata(chat)
  const participants = metadata.participants || []
  const botJid = normalizeJid(sock.user?.id)
  const senderNorm = normalizeJid(senderJid)

  const findAdmin = (jid) => {
    const num = String(jid || '').split('@')[0]
    const p = participants.find((p) => String(p.id).split('@')[0] === num)
    return !!p && (p.admin === 'admin' || p.admin === 'superadmin')
  }

  return {
    metadata,
    participants,
    isSenderAdmin: findAdmin(senderNorm),
    isBotAdmin: findAdmin(botJid),
  }
}
