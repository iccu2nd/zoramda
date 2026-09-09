import { getContentType } from '@whiskeysockets/baileys'

let handler = async (m, { conn }) => {
  if (!m.quoted?.message) {
    return m.reply('Reply pesan/media yang mau dikirim ulang, lalu ketik perintah ini.')
  }

  const qMsg = m.quoted.message
  const type = getContentType(qMsg)

  try {
    // Prefer native forward so type stays identical (sticker/image/video/audio/doc)
    await conn.sendMessage(
      m.chat,
      {
        forward: {
          key: m.quoted.key || {
            remoteJid: m.chat,
            id: m.quoted.key?.id,
            fromMe: false,
            participant: m.quoted.sender,
          },
          message: qMsg,
        },
      },
      { quoted: m.raw }
    )
    return
  } catch {
    // Fallback: download + re-upload by type
  }

  try {
    if (type === 'stickerMessage') {
      const buf = await m.download(true)
      await conn.sendMessage(m.chat, { sticker: buf }, { quoted: m.raw })
      return
    }
    if (type === 'imageMessage') {
      const buf = await m.download(true)
      const cap = qMsg.imageMessage?.caption || ''
      await conn.sendMessage(m.chat, { image: buf, caption: cap }, { quoted: m.raw })
      return
    }
    if (type === 'videoMessage') {
      const buf = await m.download(true)
      const cap = qMsg.videoMessage?.caption || ''
      await conn.sendMessage(
        m.chat,
        { video: buf, caption: cap, ptt: false },
        { quoted: m.raw }
      )
      return
    }
    if (type === 'audioMessage') {
      const buf = await m.download(true)
      const ptt = !!qMsg.audioMessage?.ptt
      await conn.sendMessage(
        m.chat,
        { audio: buf, mimetype: qMsg.audioMessage?.mimetype || 'audio/ogg; codecs=opus', ptt },
        { quoted: m.raw }
      )
      return
    }
    if (type === 'documentMessage') {
      const buf = await m.download(true)
      await conn.sendMessage(
        m.chat,
        {
          document: buf,
          mimetype: qMsg.documentMessage?.mimetype || 'application/octet-stream',
          fileName: qMsg.documentMessage?.fileName || 'file',
        },
        { quoted: m.raw }
      )
      return
    }
    if (type === 'conversation' || type === 'extendedTextMessage') {
      const text =
        qMsg.conversation ||
        qMsg.extendedTextMessage?.text ||
        ''
      if (text) await conn.sendMessage(m.chat, { text }, { quoted: m.raw })
      return
    }

    // Last resort relay
    await conn.relayMessage(m.chat, qMsg, {})
  } catch (e) {
    await m.reply(`Gagal mengirim ulang: ${e.message}`)
  }
}

handler.help = ['q (reply pesan)']
handler.tags = ['tools']
handler.command = ['q']
handler.permission = 'everyone'

export default handler
