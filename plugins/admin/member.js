/**
 * Group member management. Group-only.
 * Allowed for: the bot owner, or a WhatsApp group admin.
 * Requires the bot itself to be a group admin (WhatsApp enforces this
 * server-side, but we check first so the error message is clear).
 *
 * Usage:
 *   .kick @user       (or reply to their message)
 *   .promote @user
 *   .demote @user
 */
import { resolveTargets, checkGroupAdmin } from '../../src/utils/helpers.js'

const ACTIONS = {
  kick: { method: 'remove', verb: 'Dikeluarkan', emoji: '👢' },
  promote: { method: 'promote', verb: 'Dijadikan admin', emoji: '⬆️' },
  demote: { method: 'demote', verb: 'Diturunkan dari admin', emoji: '⬇️' },
}

let handler = async (m, { conn, args, isOwner, command, usedPrefix }) => {
  if (!m.isGroup) return m.reply('Perintah ini cuma bisa dipakai di dalam grup.')

  const action = ACTIONS[command]

  let admin
  try {
    admin = await checkGroupAdmin(conn, m.chat, m.sender)
  } catch (err) {
    return m.reply(`Gagal cek info grup: ${err.message}`)
  }

  if (!admin.isSenderAdmin && !isOwner) {
    return m.reply('Perintah ini hanya untuk admin grup atau owner bot.')
  }
  if (!admin.isBotAdmin) {
    return m.reply(`Bot harus jadi admin grup dulu untuk pakai ${usedPrefix}${command}.`)
  }

  const targets = resolveTargets(m, args)
  if (targets.length === 0) {
    return m.reply(`Target tidak ditemukan.\nContoh: ${usedPrefix}${command} @user\natau reply pesan orangnya`)
  }

  const results = []
  for (const jid of targets) {
    try {
      await conn.groupParticipantsUpdate(m.chat, [jid], action.method)
      results.push(`${action.emoji} ${jid.split('@')[0]}`)
    } catch (err) {
      results.push(`❌ ${jid.split('@')[0]} (gagal: ${err.message})`)
    }
  }

  await m.reply(`*${action.verb}:*\n${results.join('\n')}`)
}

handler.help = ['kick <@user>', 'promote <@user>', 'demote <@user>']
handler.tags = ['admin']
handler.command = ['kick', 'promote', 'demote']
handler.permission = ['admin', 'botadmin']
handler.heavy = true

export default handler
