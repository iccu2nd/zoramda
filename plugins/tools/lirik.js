import axios from 'axios'

const fetchLyrics = async (title) => {
    const { data } = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(title)}`, {
        headers: {
            referer: `https://lrclib.net/search/${encodeURIComponent(title)}`,
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
        },
        timeout: 15000
    })

    if (!data || !data[0]) throw new Error('Lirik tidak ditemukan.')

    const song = data[0]

    const track = song.trackName || 'Unknown Track'
    const artist = song.artistName || 'Unknown Artist'
    const album = song.albumName || 'Unknown Album'
    const duration = song.duration
        ? `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}`
        : '-'

    let lyr = song.plainLyrics || song.syncedLyrics || ''
    lyr = lyr.replace(/\[.*?\]/g, '').trim()
    if (!lyr) throw new Error('Lirik kosong.')

    return [
        `──「 *LYRICS* 」──\n`,
        `- *Judul* : ${track}`,
        `- *Artis* : ${artist}`,
        `- *Album* : ${album}`,
        `- *Durasi* : ${duration}\n`,
        lyr
    ].join('\n')
}

const __plugin =  {
    cmd: ['lirik', 'lyrics'],
    category: 'tools',
    run: async (m, { text, prefix, cmd }) => {
        if (!text) return m.reply(`Masukkan judul lagu.\nContoh: *${prefix}${cmd} nina feast*`)

        await m.react('⏳')

        try {
            const result = await fetchLyrics(text)
            await m.react('✅')
            m.reply(result)
        } catch (e) {
            await m.react('❌')
            m.reply(`❌ ${e.message}`)
            throw e
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

handler.command = __plugin.cmd || ['lirik', 'lyrics']
handler.help = __plugin.help || __plugin.cmd || ['lirik', 'lyrics']
handler.tags = [__plugin.category || 'tools']

export default handler
