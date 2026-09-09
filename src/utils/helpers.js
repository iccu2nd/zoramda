import { jidNormalizedUser } from '@whiskeysockets/baileys'

/** Phone-number JID: 628xxx@s.whatsapp.net */
export function isPnJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
}

/** Linked Identity JID: opaqueid@lid (WhatsApp privacy addressing) */
export function isLidJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@lid') || jid.includes('@lid'))
}

export function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us')
}

/**
 * Normalize a JID for storage/comparison.
 * Keeps @lid as-is (must not strip to digits — LID is not a phone number).
 * PN JIDs go through Baileys jidNormalizedUser.
 */
export function normalizeJid(jid) {
  if (!jid) return null
  const s = String(jid).trim()
  if (!s) return null
  if (isLidJid(s)) {
    // keep full lid form; strip device suffix if any (123:device@lid → 123@lid)
    const [user, domain] = s.split('@')
    const bare = user.split(':')[0]
    return `${bare}@${domain || 'lid'}`
  }
  try {
    return jidNormalizedUser(s)
  } catch {
    return s
  }
}

/**
 * Collect all known identity strings for a participant / user object or raw jid.
 * Used so LID and PN for the same person match each other.
 *
 * IMPORTANT: bare digits from @lid are tagged with a "lid:" prefix so they
 * never falsely match a phone-number bare id (and vice-versa).
 */
export function collectIdentities(...inputs) {
  const out = new Set()
  const add = (v, forceDomain = null) => {
    if (!v) return
    const s = String(v).trim()
    if (!s) return
    const n = normalizeJid(s)
    if (n) out.add(n)

    const [userPart, domainPart] = s.split('@')
    const bare = (userPart || '').split(':')[0]
    if (!bare) return

    const domain = forceDomain || domainPart || ''
    if (domain === 'lid' || isLidJid(s)) {
      out.add(`lid:${bare}`)
      out.add(`${bare}@lid`)
    } else if (domain === 's.whatsapp.net' || isPnJid(s) || (!domain && /^\d{8,15}$/.test(bare))) {
      out.add(`pn:${bare}`)
      out.add(bare)
      out.add(`${bare}@s.whatsapp.net`)
    } else {
      // unknown — keep bare + normalized only
      out.add(bare)
    }
  }

  for (const input of inputs) {
    if (!input) continue
    if (typeof input === 'string') {
      add(input)
      continue
    }
    if (typeof input === 'object') {
      add(input.id)
      add(input.jid)
      add(input.lid)
      add(input.phoneNumber)
      add(input.pn)
      add(input.participant)
      add(input.participantAlt)
      add(input.remoteJid)
      add(input.remoteJidAlt)
      // Baileys addressing variants
      if (input.phone_number) add(input.phone_number)
      if (input.content?.attrs) {
        add(input.content.attrs.jid)
        add(input.content.attrs.phone_number)
        add(input.content.attrs.lid)
      }
    }
  }
  return out
}

/** True if two identity sets share any key (same WhatsApp user). */
export function identitiesMatch(a, b) {
  if (!a || !b) return false
  const setA = a instanceof Set ? a : collectIdentities(a)
  const setB = b instanceof Set ? b : collectIdentities(b)
  for (const x of setA) {
    if (setB.has(x)) return true
  }
  return false
}

/**
 * Resolve sender identity from a Baileys message key.
 * Prefer PN when available (participantAlt / remoteJidAlt), keep LID as alt.
 */
export function resolveSenderFromKey(key, isGroup) {
  if (!key) return { jid: null, lid: null, pn: null }
  if (isGroup) {
    const primary = key.participant || null
    const alt = key.participantAlt || key.participantPn || null
    const lid = isLidJid(primary) ? normalizeJid(primary) : isLidJid(alt) ? normalizeJid(alt) : null
    const pn = isPnJid(alt) ? normalizeJid(alt) : isPnJid(primary) ? normalizeJid(primary) : null
    const jid = pn || normalizeJid(primary) || normalizeJid(alt)
    return { jid, lid, pn }
  }
  const primary = key.remoteJid || null
  const alt = key.remoteJidAlt || null
  const lid = isLidJid(primary) ? normalizeJid(primary) : isLidJid(alt) ? normalizeJid(alt) : null
  const pn = isPnJid(alt) ? normalizeJid(alt) : isPnJid(primary) ? normalizeJid(primary) : null
  const jid = pn || normalizeJid(primary) || normalizeJid(alt)
  return { jid, lid, pn }
}

/**
 * Find a group participant matching sender (LID and/or PN).
 * Baileys may put LID in `id` and PN in `phoneNumber` / `jid`.
 * Always pass senderAlts.lid when available.
 */
export function findParticipant(participants, senderJid, senderAlts = {}) {
  if (!Array.isArray(participants) || (!senderJid && !senderAlts?.lid && !senderAlts?.pn)) {
    return null
  }
  const want = collectIdentities(
    senderJid,
    senderAlts.lid,
    senderAlts.pn,
    senderAlts.jid,
    senderAlts.participant
  )
  if (!want.size) return null

  for (const p of participants) {
    const have = collectIdentities(p)
    if (identitiesMatch(want, have)) return p
  }
  return null
}

/** admin | superadmin only — never treat missing participant as admin */
export function isParticipantAdmin(p) {
  if (!p) return false
  const a = p.admin
  return a === 'admin' || a === 'superadmin' || a === true
}

export function isOwner(jid, ownerNumbers = [], alts = {}) {
  if (!jid && !alts.lid && !alts.pn) return false
  const candidates = [jid, alts.pn, alts.jid].filter(Boolean)
  for (const c of candidates) {
    if (isLidJid(c)) continue
    const num = String(c).split('@')[0].replace(/\D/g, '')
    if (!num) continue
    if (ownerNumbers.some((o) => String(o).replace(/\D/g, '') === num)) return true
  }
  return false
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
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
 * Turn a raw number/text arg into a WhatsApp PN JID.
 */
export function numberToJid(text) {
  if (!text) return null
  const digits = String(text).replace(/\D/g, '')
  if (!digits) return null
  return `${digits}@s.whatsapp.net`
}

/**
 * Resolve targets for admin commands: mentions, quoted, then number arg.
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
 * Group admin check — always uses LIVE groupMetadata from WhatsApp
 * (not DB / long-lived cache). Pass LID+PN in senderAlts for accuracy.
 *
 * @param {object} sock
 * @param {string} chat group jid
 * @param {string} senderJid preferred sender jid (usually PN)
 * @param {{ lid?: string, pn?: string, jid?: string }} [senderAlts]
 */
export async function checkGroupAdmin(sock, chat, senderJid, senderAlts = {}) {
  // Always fetch latest from WA — source of truth for admin/superadmin
  const metadata = await sock.groupMetadata(chat)
  const participants = metadata.participants || []
  const botId = sock.user?.id
  const botLid = sock.user?.lid || null

  const senderP = findParticipant(participants, senderJid, senderAlts)
  const botP = findParticipant(participants, botId, {
    lid: botLid ? normalizeJid(botLid) : null,
    pn: normalizeJid(botId),
  })

  return {
    metadata,
    participants,
    isSenderAdmin: isParticipantAdmin(senderP),
    isBotAdmin: isParticipantAdmin(botP),
    senderParticipant: senderP,
    botParticipant: botP,
  }
}

