import axios from 'axios'

async function getInstagramInfo(url) {
  const encoded = encodeURIComponent(url)
  const apiUrl = `https://igdl.net/api/public/ig-info?url=${encoded}`
  const response = await axios.get(apiUrl, {
    timeout: 30000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Referer: 'https://igdl.net/',
    },
  })
  return response.data
}

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `Masukkan URL Instagram.\nContoh: *${usedPrefix}${command}* https://www.instagram.com/reel/...`
    )
  }
  const url = text.trim()
  if (!/instagram\.com/i.test(url)) return m.reply('URL harus Instagram.')

  await m.reply('⏳ Mengunduh Instagram…')
  try {
    const info = await getInstagramInfo(url)
    if (!info || !info.kind) throw new Error('Gagal mendapatkan info media')

    const { kind, videos, images, caption, author, handle } = info
    let mediaUrl = null
    if (kind === 'video' && videos?.length) mediaUrl = videos[0].url
    else if (images?.length) {
      const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0))
      mediaUrl = sorted[0].url
    }
    if (!mediaUrl) throw new Error('Media tidak ditemukan')

    const mediaRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 60000 })
    const buffer = Buffer.from(mediaRes.data)

    let captionText = ''
    if (author || handle) {
      captionText += `*${author || handle}*`
      if (handle) captionText += ` (@${handle})`
      captionText += '\n'
    }
    if (caption) captionText += `${caption}\n`
    captionText += `\n${url}`

    if (kind === 'video') {
      await conn.sendMessage(m.chat, { video: buffer, caption: captionText }, { quoted: m.raw })
    } else {
      await conn.sendMessage(m.chat, { image: buffer, caption: captionText }, { quoted: m.raw })
    }
  } catch (e) {
    await m.reply(`Gagal unduh IG: ${e.message}`)
  }
}

handler.help = ['igdl <url>', 'ig <url>']
handler.tags = ['downloader']
handler.command = ['igdl', 'ig', 'instagram', 'instagramdl']
handler.permission = 'everyone'
handler.heavy = true

export default handler
