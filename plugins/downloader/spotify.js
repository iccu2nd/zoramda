import axios from "axios"

class SpotifyDL {
  constructor() {
    this.api = {
      meta: "https://spotify.dlapi.app/api/Gettrack",
      convert: "https://master.dlapi.app/api/v1/convert",
      task: "https://master.dlapi.app/api/v1/tasks"
    }
    this.client = axios.create({
      headers: {
        Authorization: "Bearer pGLXoCsVu0hcstAecIDwlrlbcrUzv0e1cWBJ0yuB",
        "Content-Type": "application/json",
        "User-Agent": "Spotmate/1.0"
      }
    })
  }

  valid(url) {
    return /^(https?:\/\/)?(open\.)?spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/.test(url)
  }

  async meta(url) {
    const { data } = await this.client.get(this.api.meta, { params: { spotify_url: url } })
    if (!data) throw new Error("API Data Empty")
    return data
  }

  async convert(url, format = "mp3") {
    const { data: init } = await this.client.post(this.api.convert, { url, format })
    if (init?.download_url) return init.download_url

    const taskId = init?.task_id || init?.id
    if (!taskId) throw new Error("No Task ID received")

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const { data: status } = await this.client.get(`${this.api.task}/${taskId}`)
      if (status?.status === "finished" || status?.status === "completed") {
        return status?.result?.download_url || status?.download_url
      }
      if (status?.status === "failed") throw new Error("Server-side processing failed")
    }
    throw new Error("Task Timeout")
  }

  async download({ url, format = "mp3" }) {
    if (!this.valid(url)) throw new Error("Invalid Spotify URL")
    const data = await this.meta(url)
    const targetUrl = data?.external_urls?.spotify || url
    const downloadUrl = await this.convert(targetUrl, format)

    return {
      title: data.name,
      artist: data.artists?.map(a => a.name).join(", "),
      album: data.album?.name,
      duration: data.duration_ms,
      cover: data.album?.images?.[0]?.url,
      download: downloadUrl
    }
  }
}

const __plugin =  {
  cmd: ['spotify', 'spotifydl'],
  category: 'downloader',
  description: 'Download lagu dari Spotify',

  run: async (m, { sock, text, prefix, cmd }) => {
    if (!text) {
      return m.reply(
        `Spotify Downloader\n\n` +
        `- ${prefix}${cmd} <url>\n\n` +
        `Contoh:\n` +
        `${prefix}${cmd} https://open.spotify.com/track/xxxxx\n` +
        `${prefix}${cmd} https://open.spotify.com/playlist/xxxxx`
      )
    }

    if (!text.includes('spotify.com')) {
      return m.reply('Link tidak valid. Pastikan link dari Spotify.')
    }

    await m.reply('⏳ Memproses... (bisa memakan waktu 30-60 detik)')

    try {
      const api = new SpotifyDL()
      const result = await api.download({ url: text })

      if (!result.download) {
        return m.reply('Gagal mendapatkan link download.')
      }

      let caption = `🎵 Spotify Downloader\n\n`
      caption += `Title: ${result.title || 'Unknown'}\n`
      caption += `Artist: ${result.artist || 'Unknown'}\n`
      caption += `Album: ${result.album || 'Unknown'}\n`
      caption += `Duration: ${result.duration ? Math.floor(result.duration / 1000) + 's' : 'Unknown'}`

      const audioRes = await axios.get(result.download, { responseType: 'arraybuffer', timeout: 60000 })
      const audioBuffer = Buffer.from(audioRes.data)

      await sock.sendMessage(m.chat, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        fileName: `${result.title || 'audio'}.mp3`,
        caption: caption
      }, { quoted: m })

    } catch (e) {
      console.error(e)
      await m.reply(`Error: ${e.message || 'Terjadi kesalahan'}`)
    }
  }
};

let handler = async (m, ctx) => {
  const sock = ctx.sock || ctx.conn
  const conn = ctx.conn || sock
  const text = ctx.text || m.body || ''
  const args = ctx.args || m.args || []
  const prefix = ctx.prefix || ctx.usedPrefix || m.usedPrefix || '.'
  const usedPrefix = prefix
  const command = ctx.command || m.command
  const config = ctx.config || {}
  const isOwner = ctx.isOwner
  const isPremium = ctx.isPremium
  if (typeof __plugin.run !== 'function') throw new Error('Plugin run missing')
  return __plugin.run(m, {
    sock, conn, text, args, prefix, usedPrefix, command, cmd: command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin,
  })
}

handler.command = __plugin.cmd || ['spotify', 'spotifydl']
handler.help = __plugin.help || __plugin.cmd || ['spotify', 'spotifydl']
handler.tags = [__plugin.category || 'downloader']
handler.heavy = true

export default handler
