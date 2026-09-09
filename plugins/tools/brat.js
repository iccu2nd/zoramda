import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command, botConfig }) => {
  if (!text) {
    return m.reply(`Masukkan teks.\nContoh: *${usedPrefix}${command} halo dunia*`)
  }
  try {
    const url = `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(text)}`
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 })
    const buf = Buffer.from(res.data)
    await conn.sendMessage(
      m.chat,
      {
        sticker: buf,
        mimetype: 'image/webp',
      },
      { quoted: m.raw }
    )
  } catch (e) {
    // fallback: send as image if webp sticker fails
    try {
      const url = `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(text)}`
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 })
      await conn.sendMessage(m.chat, { image: Buffer.from(res.data), caption: text }, { quoted: m.raw })
    } catch (err) {
      await m.reply(`Gagal membuat brat: ${err.message || e.message}`)
    }
  }
}

handler.help = ['brat <teks>']
handler.tags = ['tools']
handler.command = ['brat']
handler.permission = 'everyone'
handler.heavy = true

export default handler
