/**
 * Mention every group member. Group-only, admin/owner only.
 *
 * .tagall [pesan]   – shows every member's number in the message
 * .hidetag [pesan]  – same mention ping, but the number list is hidden
 *                      (only the text you typed is shown)
 */
import { checkGroupAdmin } from '../../src/utils/helpers.js'

let handler = async (m, { conn, text, isOwner, command }) => {
  if (!m.isGroup) return m.reply('Perintah ini cuma bisa dipakai di dalam grup.')

  let admin
  try {
    admin = await checkGroupAdmin(conn, m.chat, m.sender)
  } catch (err) {
    return m.reply(`Gagal cek info grup: ${err.message}`)
  }

  if (!admin.isSenderAdmin && !isOwner) {
    return m.reply('Perintah ini hanya untuk admin grup atau owner bot.')
  }

  const participants = admin.participants.map((p) => p.id)
  if (participants.length === 0) return m.reply('Grup ini tidak punya member.')

  let message
  if (command === 'hidetag') {
    message = text || ''
  } else {
    const list = participants.map((jid, i) => `${i + 1}. @${jid.split('@')[0]}`).join('\n')
    message = `${text ? `${text}\n\n` : ''}${list}`
  }

  await conn.sendMessage(m.chat, { text: message, mentions: participants }, { quoted: m.raw })
}

handler.help = ['tagall [pesan]', 'hidetag [pesan]']
handler.tags = ['admin']
handler.command = ['tagall', 'hidetag']
handler.permission = 'admin'
handler.heavy = true

export default handler
