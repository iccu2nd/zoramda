import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command, config }) => {
  if (!text) {
    return m.reply(`Masukkan teks.\nContoh: *${usedPrefix + command} teks isi sendiri*`)
  }

  await m.react('🕐')

  try {
    const url = `https://aqul-brat.hf.space/api/brat?text=${encodeURIComponent(text)}`
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 })
    const buf = Buffer.from(res.data)

    await conn.sendSticker(m.chat, buf, m.raw, {
      packname: config.get('packName') || 'Botenv',
      author: config.get('author') || '',
      isAnimated: false,
    })

    await m.react('✅')
  } catch (err) {
    await m.react('❌')
    await m.reply(`❌ Gagal: ${err.message}`)
    throw err
  }
}

handler.help = ['brat <teks>']
handler.tags = ['tools']
handler.command = ['brat']
handler.heavy = true

export default handler
