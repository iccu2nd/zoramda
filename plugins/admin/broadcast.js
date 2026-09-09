/**
 * Owner-only broadcast — sends a message to every group this session's
 * WhatsApp number is a participant of.
 *
 * Usage: .broadcast <pesan>
 * Or reply to any message (text/image/video) with .broadcast to forward it.
 *
 * Sent with a short delay between each group to stay well under WhatsApp's
 * spam-detection thresholds — this is NOT instant, on purpose.
 */
import { sleep } from '../../src/utils/helpers.js'

const DELAY_MS = 1500

let handler = async (m, { conn, text, isOwner, botName }) => {
  if (!isOwner) return m.reply('Perintah ini hanya untuk owner.')

  const content = m.quoted?.message
    ? { forward: m.quoted }
    : text
      ? { text: `📢 *Broadcast dari ${botName}*\n\n${text}` }
      : null

  if (!content) {
    return m.reply('Isi pesan kosong.\nContoh: .broadcast Halo semua!\natau reply pesan lalu ketik .broadcast')
  }

  let groups
  try {
    groups = await conn.groupFetchAllParticipating()
  } catch (err) {
    return m.reply(`Gagal ambil daftar grup: ${err.message}`)
  }

  const groupIds = Object.keys(groups || {})
  if (groupIds.length === 0) return m.reply('Bot belum join grup manapun.')

  await m.reply(`⏳ Mengirim broadcast ke ${groupIds.length} grup...`)

  let sent = 0
  let failed = 0
  for (const gid of groupIds) {
    try {
      if (content.forward) {
        await conn.sendMessage(gid, { forward: content.forward })
      } else {
        await conn.sendMessage(gid, content)
      }
      sent++
    } catch {
      failed++
    }
    await sleep(DELAY_MS)
  }

  await m.reply(`✅ Broadcast selesai.\nBerhasil: ${sent}\nGagal: ${failed}`)
}

handler.help = ['broadcast <pesan>']
handler.tags = ['admin']
handler.command = ['broadcast']
handler.permission = 'admin'
handler.heavy = true

export default handler
