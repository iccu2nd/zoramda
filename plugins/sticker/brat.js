import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Masukkan teks.\nContoh: *${usedPrefix + command} teks isi sendiri*`)
  }

  await conn.sendMessage(m.chat, { react: { text: '🕐', key: m.key } })

  try {
    const url = `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(text)}`
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 })
    const buf = Buffer.from(res.data)

    await conn.sendMessage(m.chat, { sticker: buf }, { quoted: m.raw })

    await conn.sendMessage(m.chat, { react: { text: '✅', key: m.key } })
  } catch (err) {
    await conn.sendMessage(m.chat, { react: { text: '❌', key: m.key } })
    await m.reply(`❌ Gagal: ${err.message}`)
    throw err
  }
}

handler.help = ['brat <teks>']
handler.tags = ['tools']
handler.command = ['brat']
handler.permission = 'everyone'
handler.heavy = true

export default handler
