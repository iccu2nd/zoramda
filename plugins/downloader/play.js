import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(`Cari / putar audio YouTube.\nContoh: *${usedPrefix}${command} fatalism natori*`)
  }

  await m.reply('⏳ Mencari & mengunduh audio…')
  try {
    let ytUrl = text.trim()
    let title = text.trim()

    if (!/youtube\.com|youtu\.be/i.test(ytUrl)) {
      // search
      const search = await axios.get(
        `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(text)}`,
        { timeout: 25000 }
      )
      const items = search.data?.data || search.data?.result || []
      const first = Array.isArray(items) ? items[0] : null
      if (!first) throw new Error('Hasil pencarian kosong')
      ytUrl = first.url || first.link || first.videoId
      if (ytUrl && !/^https?:/i.test(ytUrl) && first.videoId) {
        ytUrl = `https://www.youtube.com/watch?v=${first.videoId}`
      }
      title = first.title || title
    }

    if (!ytUrl) throw new Error('URL YouTube tidak ditemukan')

    // try mp3 endpoints
    let audioUrl = null
    let metaTitle = title

    try {
      const r = await axios.get(
        `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(ytUrl)}`,
        { timeout: 45000 }
      )
      audioUrl = r.data?.data?.dl || r.data?.result || r.data?.url || r.data?.data?.url
      metaTitle = r.data?.data?.title || r.data?.title || metaTitle
    } catch {}

    if (!audioUrl) {
      try {
        const r = await axios.get(
          `https://yt-api.p.rapidapi.com/dl?id=`,
          { timeout: 5000 }
        )
        // skip rapidapi without key
      } catch {}
    }

    if (!audioUrl || typeof audioUrl !== 'string') {
      // last try: savetube style public
      try {
        const r = await axios.get(
          `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(ytUrl)}`,
          { timeout: 45000 }
        )
        audioUrl = r.data?.data?.dl || r.data?.result || r.data?.url
        metaTitle = r.data?.data?.title || metaTitle
      } catch {}
    }

    if (!audioUrl) throw new Error('Gagal mendapatkan link audio')

    const audio = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 90000 })
    await conn.sendMessage(
      m.chat,
      {
        audio: Buffer.from(audio.data),
        mimetype: 'audio/mpeg',
        fileName: `${String(metaTitle).slice(0, 60)}.mp3`,
        ptt: false,
      },
      { quoted: m.raw }
    )
    await m.reply(`🎵 *${metaTitle}*`)
  } catch (e) {
    await m.reply(`Gagal play: ${e.message}`)
  }
}

handler.help = ['play <judul|url>']
handler.tags = ['downloader']
handler.command = ['play', 'ytplay', 'yta']
handler.permission = 'everyone'
handler.heavy = true

export default handler
