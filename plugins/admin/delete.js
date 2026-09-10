/**
 * Delete a message. Reply to the message you want deleted with .delete
 * (or .del). In groups, the bot needs to be a group admin to delete other
 * people's messages — it can always delete its own.
 */
import { checkGroupAdmin } from '../../src/utils/helpers.js'

let handler = async (m, { conn, isOwner, usedPrefix }) => {
  if (!m.quoted) {
    return m.reply(`Reply pesan yang mau dihapus dengan ${usedPrefix}delete`)
  }

  const isOwnMessage = m.quoted.fromMe

  if (m.isGroup && !isOwnMessage) {
    let admin
    try {
      admin = await checkGroupAdmin(conn, m.chat, m.sender, { lid: m.senderLid, pn: m.senderPn })
    } catch (err) {
      return m.reply(`Gagal cek info grup: ${err.message}`)
    }
    if (!admin.isSenderAdmin && !isOwner) {
      return m.reply('Perintah ini hanya untuk admin grup atau owner bot.')
    }
    if (!admin.isBotAdmin) {
      return m.reply(`Bot harus jadi admin grup dulu untuk hapus pesan orang lain.`)
    }
  } else if (!m.isGroup && !isOwnMessage && !isOwner) {
    return m.reply('Cuma bisa hapus pesan bot sendiri di chat pribadi.')
  }

  try {
    await m.quoted.delete()
  } catch (err) {
    await m.reply(`Gagal hapus pesan: ${err.message}`)
  }
}

handler.help = ['delete (reply pesan)']
handler.tags = ['admin']
handler.command = ['delete', 'del']
handler.permission = ['admin', 'botadmin']

export default handler
