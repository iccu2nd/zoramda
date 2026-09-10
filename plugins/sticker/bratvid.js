import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command, config }) => {
  if (!text) {
    return m.reply(`Masukkan teks.\nContoh: *${usedPrefix + command} teks sangat*`)
  }

  await m.react('🕐')

  try {
    const url = `https://skyzxu-brat.hf.space/brat-animated?text=${encodeURIComponent(text)}`
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    const buf = Buffer.from(res.data)

    await conn.sendSticker(m.chat, buf, m.raw, {
      packname: config.get('packName') || 'Botenv',
      author: config.get('author') || '',
      isAnimated: true,
    })

    await m.react('✅')
  } catch (err) {
    await m.react('❌')
    await m.reply(`❌ Gagal: ${err.message}`)
    throw err
  }
}

handler.help = ['bratvid <teks>']
handler.tags = ['tools']
handler.command = ['bratvid', 'bratv']
handler.permission = 'everyone'
handler.heavy = true

export default handler
