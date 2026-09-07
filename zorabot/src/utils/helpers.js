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

export function serializeError(err) {
  if (!err) return null
  return {
    message: err.message || String(err),
    name: err.name,
    code: err.code || err.output?.statusCode,
  }
}
