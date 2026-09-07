/**
 * Group settings. Group-only, admin/owner only.
 *
 * .group open        – semua member boleh chat
 * .group close        – cuma admin yang boleh chat
 * .group name <teks>  – ganti nama grup
 * .group desc <teks>  – ganti deskripsi grup
 */
import { checkGroupAdmin } from '../../src/utils/helpers.js'

let handler = async (m, { conn, args, isOwner, usedPrefix }) => {
  if (!m.isGroup) return m.reply('Perintah ini cuma bisa dipakai di dalam grup.')

  const sub = (args[0] || '').toLowerCase()
  const rest = args.slice(1).join(' ').trim()

  if (!['open', 'close', 'name', 'desc'].includes(sub)) {
    return m.reply(
      `Cara pakai:\n${usedPrefix}group open\n${usedPrefix}group close\n${usedPrefix}group name <teks>\n${usedPrefix}group desc <teks>`
    )
  }

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
    return m.reply(`Bot harus jadi admin grup dulu untuk pakai ${usedPrefix}group.`)
  }

  try {
    if (sub === 'open') {
      await conn.groupSettingUpdate(m.chat, 'not_announcement')
      return m.reply('🔓 Grup dibuka — semua member boleh chat.')
    }
    if (sub === 'close') {
      await conn.groupSettingUpdate(m.chat, 'announcement')
      return m.reply('🔒 Grup ditutup — cuma admin yang boleh chat.')
    }
    if (sub === 'name') {
      if (!rest) return m.reply(`Nama tidak boleh kosong.\nContoh: ${usedPrefix}group name Nama Baru`)
      await conn.groupUpdateSubject(m.chat, rest.slice(0, 100))
      return m.reply(`✅ Nama grup diubah jadi:\n${rest.slice(0, 100)}`)
    }
    if (sub === 'desc') {
      if (!rest) return m.reply(`Deskripsi tidak boleh kosong.\nContoh: ${usedPrefix}group desc Deskripsi baru`)
      await conn.groupUpdateDescription(m.chat, rest.slice(0, 512))
      return m.reply('✅ Deskripsi grup diubah.')
    }
  } catch (err) {
    await m.reply(`Gagal: ${err.message}`)
  }
}

handler.help = ['group open', 'group close', 'group name <teks>', 'group desc <teks>']
handler.tags = ['admin']
handler.command = ['group']
handler.permission = ['admin', 'botadmin']

export default handler
