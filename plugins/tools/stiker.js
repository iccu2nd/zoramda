import axios from 'axios'
import { getContentType } from '@whiskeysockets/baileys'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  try {
    let buf = null
    let mime = ''

    // 1) reply media
    if (m.quoted?.message) {
      try {
        buf = await m.download(true)
        mime = buf.mimetype || ''
      } catch {}
    }

    // 2) URL in text
    if (!buf && text && /^https?:\/\//i.test(text.trim())) {
      const res = await axios.get(text.trim(), { responseType: 'arraybuffer', timeout: 25000 })
      buf = Buffer.from(res.data)
      mime = res.headers['content-type'] || ''
    }

    if (!buf) {
      return m.reply(
        `Kirim / reply gambar atau video pendek, atau beri URL.\nContoh:\n• reply gambar + *${usedPrefix}${command}*\n• *${usedPrefix}${command}* https://...`
      )
    }

    // Already webp → send as sticker
    if (/webp/i.test(mime) || buf.slice(0, 4).toString() === 'RIFF') {
      await conn.sendMessage(m.chat, { sticker: buf }, { quoted: m.raw })
      return
    }

    // Image / short video: try as sticker (Baileys accepts some formats), else image
    try {
      await conn.sendMessage(m.chat, { sticker: buf }, { quoted: m.raw })
    } catch {
      await conn.sendMessage(
        m.chat,
        { image: buf, caption: 'Tidak bisa konversi ke stiker otomatis. Berikut medianya.' },
        { quoted: m.raw }
      )
    }
  } catch (e) {
    await m.reply(`Gagal buat stiker: ${e.message}`)
  }
}

handler.help = ['stiker', 'sticker', 's']
handler.tags = ['tools']
handler.command = ['stiker', 'sticker', 's']
handler.permission = 'everyone'
handler.heavy = true

export default handler
