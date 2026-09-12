import { downloadMediaMessage } from '@whiskeysockets/baileys'

const MAX_VIDEO_SECONDS = 6

let handler = async (m, { conn, usedPrefix, command, config }) => {
  // Contoh pakai m.quoted: kalau reply ke foto/video, tinggal cek m.quoted.isMedia
  const useQuoted = m.quoted?.isMedia
  const mediaType = useQuoted ? m.quoted.mediaType : m.type

  const isImage = mediaType === 'imageMessage'
  const isVideo = mediaType === 'videoMessage'

  if (!isImage && !isVideo) {
    return m.reply(
      `Kirim/reply foto atau video pendek dengan caption *${usedPrefix + command}*\n` +
        `(video maksimal ${MAX_VIDEO_SECONDS} detik)`
    )
  }

  if (isVideo) {
    const seconds = (useQuoted ? m.quoted.mediaMessage?.videoMessage : m.raw.message?.videoMessage)?.seconds || 0
    if (seconds > MAX_VIDEO_SECONDS) {
      return m.reply(`Video terlalu panjang. Maksimal ${MAX_VIDEO_SECONDS} detik ya.`)
    }
  }

  await m.react('🕐')

  try {
    // m.quoted.download() sudah otomatis nangani media dari pesan yang di-reply
    const buffer = useQuoted
      ? await m.quoted.download()
      : await downloadMediaMessage(m.raw, 'buffer', {}, { reuploadRequest: conn.updateMediaMessage })

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
handler.heavy = true

export default handler
