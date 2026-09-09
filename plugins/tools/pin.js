import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Cari gambar Pinterest.\nContoh: *${usedPrefix}${command} anime aesthetic*`)
  }
  await m.reply('🔎 Mencari…')
  try {
    const res = await axios.get(
      `https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(text)}`,
      { timeout: 25000 }
    )
    const list = res.data?.data || res.data?.result || res.data || []
    const items = Array.isArray(list) ? list : []
    if (!items.length) return m.reply('Tidak ada hasil.')

    const pick = items[Math.floor(Math.random() * Math.min(items.length, 10))]
    const imgUrl = pick?.image || pick?.images_url || pick?.url || pick?.pin || pick
    if (!imgUrl || typeof imgUrl !== 'string') return m.reply('Hasil tidak valid.')

    const img = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 })
    await conn.sendMessage(
      m.chat,
      { image: Buffer.from(img.data), caption: `📌 *Pinterest*\n${text}` },
      { quoted: m.raw }
    )
  } catch (e) {
    await m.reply(`Gagal: ${e.message}`)
  }
}

handler.help = ['pin <query>']
handler.tags = ['tools']
handler.command = ['pin', 'pinterest']
handler.permission = 'everyone'
handler.heavy = true

export default handler
