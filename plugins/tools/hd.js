import axios from 'axios'

let handler = async (m, { conn, usedPrefix, command }) => {
  let buf
  try {
    buf = await m.download(true)
  } catch {
    return m.reply(`Reply gambar yang mau di-HD.\nContoh: reply foto + *${usedPrefix}${command}*`)
  }

  if (!buf) return m.reply('Media harus berupa gambar.')
  if (buf.mimetype && !/image|webp/i.test(buf.mimetype)) {
    return m.reply('Media harus berupa gambar (bukan video).')
  }

  await m.reply('⏳ Memproses HD…')
  try {
    let out = null
    const b64 = buf.toString('base64')

    // Primary: remini-style API
    try {
      const res = await axios.post(
        'https://api.siputzx.my.id/api/tools/remini',
        { img: b64 },
        { timeout: 60000 }
      )
      const url = res.data?.result || res.data?.url || res.data?.data
      if (typeof url === 'string' && url.startsWith('http')) {
        const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 })
        out = Buffer.from(img.data)
      } else if (typeof res.data?.base64 === 'string') {
        out = Buffer.from(res.data.base64, 'base64')
      } else if (Buffer.isBuffer(res.data)) {
        out = Buffer.from(res.data)
      }
    } catch {}

    if (!out || !out.length) {
      try {
        const res = await axios.post(
          'https://api.siputzx.my.id/api/iloveimg/upscale',
          { image: b64, scale: command === 'hdr' ? 4 : 2 },
          { timeout: 60000, responseType: 'arraybuffer' }
        )
        out = Buffer.from(res.data)
      } catch {}
    }

    if (!out || !out.length) {
      return m.reply('Gagal upscale. Server HD sedang sibuk — coba lagi nanti.')
    }

    await conn.sendMessage(m.chat, { image: out, caption: '✅ HD selesai' }, { quoted: m.raw })
  } catch (e) {
    await m.reply(`Gagal HD: ${e.message}`)
  }
}

handler.help = ['hd', 'hdr']
handler.tags = ['tools']
handler.command = ['hd', 'hdr']
handler.permission = 'everyone'
handler.heavy = true

export default handler
