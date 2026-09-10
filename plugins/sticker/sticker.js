import { downloadMediaMessage, extractMessageContent } from '@whiskeysockets/baileys'

const MAX_VIDEO_SECONDS = 6

/** Ambil { key, message } dari foto/video yang di-reply, atau dari pesan itu sendiri. */
function resolveTarget(m) {
  if (m.quoted?.message) {
    return { key: m.quoted.key, message: extractMessageContent(m.quoted.message) }
  }
  return { key: m.key, message: extractMessageContent(m.raw.message) }
}

let handler = async (m, { conn, usedPrefix, command, config }) => {
  const target = resolveTarget(m)
  const message = target.message || {}

  const isImage = !!message.imageMessage
  const isVideo = !!message.videoMessage

  if (!isImage && !isVideo) {
    return m.reply(
      `Kirim/reply foto atau video pendek dengan caption *${usedPrefix + command}*\n` +
        `(video maksimal ${MAX_VIDEO_SECONDS} detik)`
    )
  }

  if (isVideo) {
    const seconds = message.videoMessage?.seconds || 0
    if (seconds > MAX_VIDEO_SECONDS) {
      return m.reply(`Video terlalu panjang. Maksimal ${MAX_VIDEO_SECONDS} detik ya.`)
    }
  }

  await m.react('🕐')

  try {
    const buffer = await downloadMediaMessage(
      target,
      'buffer',
      {},
      { reuploadRequest: conn.updateMediaMessage }
    )

    await conn.sendSticker(m.chat, buffer, m.raw, {
      packname: config.get('packName') || 'Botenv',
      author: config.get('author') || '',
      isAnimated: isVideo,
    })

    await m.react('✅')
  } catch (err) {
    await m.react('❌')
    await m.reply(`❌ Gagal bikin stiker: ${err.message}`)
    throw err
  }
}

handler.help = ['sticker', 's (reply foto/video)']
handler.tags = ['sticker']
handler.command = ['s', 'sticker', 'stiker']
handler.permission = 'everyone'
handler.heavy = true

export default handler
