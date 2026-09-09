import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Masukkan URL TikTok.\nContoh: *${usedPrefix}${command}* https://vt.tiktok.com/...`)
  }
  const url = text.trim()
  if (!/tiktok\.com|vt\.tiktok/i.test(url)) {
    return m.reply('URL harus TikTok.')
  }

  await m.reply('⏳ Mengunduh TikTok…')
  try {
    const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const data = res.data?.data || res.data
    if (!data) throw new Error('Tidak ada data')

    const videoUrl = data.play || data.hdplay || data.wmplay
    if (!videoUrl) throw new Error('Video tidak ditemukan')

    const vid = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000 })
    const caption = [
      data.title ? `*${data.title}*` : null,
      data.author?.nickname ? `👤 ${data.author.nickname}` : null,
      url,
    ]
      .filter(Boolean)
      .join('\n')

    await conn.sendMessage(
      m.chat,
      { video: Buffer.from(vid.data), caption },
      { quoted: m.raw }
    )
  } catch (e) {
    await m.reply(`Gagal unduh TikTok: ${e.message}`)
  }
}

handler.help = ['tiktokdl <url>', 'tt <url>', 'tiktok <url>']
handler.tags = ['downloader']
handler.command = ['tiktokdl', 'tt', 'tiktok', 'ttdl']
handler.permission = 'everyone'
handler.heavy = true

export default handler
