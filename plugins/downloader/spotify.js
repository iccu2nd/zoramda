import axios from 'axios'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  if (!text) {
    return m.reply(
      `Cari lagu Spotify / unduh via link.\nContoh:\n• *${usedPrefix}${command} blur oasis*\n• *${usedPrefix}${command}* https://open.spotify.com/track/...`
    )
  }

  await m.reply('⏳ Memproses Spotify…')
  try {
    const q = text.trim()
    let trackUrl = q
    let title = q

    if (!/open\.spotify\.com/i.test(q)) {
      const search = await axios.get(
        `https://api.siputzx.my.id/api/s/spotify?query=${encodeURIComponent(q)}`,
        { timeout: 25000 }
      )
      const items = search.data?.data || search.data?.result || []
      const first = Array.isArray(items) ? items[0] : null
      if (!first) throw new Error('Lagu tidak ditemukan')
      trackUrl = first.url || first.link || first.spotify || first.external_url
      title = first.title || first.name || title
      if (first.artist) title = `${title} — ${first.artist}`
    }

    if (!trackUrl) throw new Error('Link Spotify tidak ada')

    let audioUrl = null
    try {
      const r = await axios.get(
        `https://api.siputzx.my.id/api/d/spotify?url=${encodeURIComponent(trackUrl)}`,
        { timeout: 45000 }
      )
      audioUrl =
        r.data?.data?.download ||
        r.data?.data?.url ||
        r.data?.result ||
        r.data?.url ||
        r.data?.download
      title = r.data?.data?.title || r.data?.title || title
    } catch {}

    if (!audioUrl) {
      // fallback: treat as play search on youtube
      const r = await axios.get(
        `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(title)}`,
        { timeout: 25000 }
      )
      const items = r.data?.data || r.data?.result || []
      const first = Array.isArray(items) ? items[0] : null
      const yt = first?.url || (first?.videoId ? `https://www.youtube.com/watch?v=${first.videoId}` : null)
      if (!yt) throw new Error('Gagal mendapatkan audio')
      const dl = await axios.get(
        `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(yt)}`,
        { timeout: 45000 }
      )
      audioUrl = dl.data?.data?.dl || dl.data?.result || dl.data?.url
      title = dl.data?.data?.title || title
    }

    if (!audioUrl) throw new Error('Link audio tidak tersedia')

    const audio = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 90000 })
    await conn.sendMessage(
      m.chat,
      {
        audio: Buffer.from(audio.data),
        mimetype: 'audio/mpeg',
        fileName: `${String(title).slice(0, 60)}.mp3`,
      },
      { quoted: m.raw }
    )
    await m.reply(`🎧 *${title}*`)
  } catch (e) {
    await m.reply(`Gagal Spotify: ${e.message}`)
  }
}

handler.help = ['spotify <judul|url>']
handler.tags = ['downloader']
handler.command = ['spotify', 'spdl']
handler.permission = 'everyone'
handler.heavy = true

export default handler
