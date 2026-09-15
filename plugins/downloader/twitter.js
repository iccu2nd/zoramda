import axios from 'axios'
import * as cheerio from 'cheerio'

const SSSX_BASE = 'https://sssx.io'
const SSSX_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
}

const sssx = async (url, locale = 'en') => {
    const { data: home } = await axios.get(SSSX_BASE, { headers: SSSX_HEADERS })

    const includeVals =
        home.match(/include-vals="([^"]+)"/)?.[1] ||
        cheerio.load(home)('form').attr('include-vals') ||
        ''

    const tt = includeVals.match(/tt['"]?\s*:\s*['"]([a-f0-9]{32})/i)?.[1]
    const ts = includeVals.match(/ts\s*:\s*(\d+)/)?.[1]

    if (!tt || !ts) throw new Error('Gagal mengambil token dari sssx.io')

    const body = new URLSearchParams({ id: url, locale, tt, ts, source: 'form' })

    const { data } = await axios.post(SSSX_BASE, body.toString(), {
        headers: {
            ...SSSX_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'HX-Request': 'true',
            'HX-Target': 'target',
            'HX-Current-URL': SSSX_BASE + '/',
            Origin: SSSX_BASE,
            Referer: SSSX_BASE + '/'
        }
    })

    const $ = cheerio.load(data)
    const downloads = $('a.download_link.download-btn').map((_, el) => ({
        quality: $(el).text().replace(/Download/i, '').trim(),
        url: $(el).attr('href'),
        directUrl: $(el).attr('data-directurl') || null
    })).get()

    return { success: downloads.length > 0, downloads }
}

const __plugin =  {
    cmd: ['twitter', 'twt', 'x', 'xdl'],
    category: 'downloader',
    description: 'Download video dari Twitter/X',

    run: async (m, { sock, text, config }) => {
        if (!text) return m.reply('Masukkan URL Twitter/X yang valid!')
        if (!/twitter\.com|x\.com/.test(text)) return m.reply('Link tidak valid!')

        await m.react('⏳')

        try {
            const res = await sssx(text)
            if (!res.success) {
                await m.react('❌')
                return m.reply('Gagal mendapatkan link download.')
            }

            const video = res.downloads.find(v => /hd/i.test(v.quality)) || res.downloads[0]
            const videoUrl = video.directUrl || video.url

            const { data: stream } = await axios.get(videoUrl, {
                headers: SSSX_HEADERS,
                responseType: 'stream'
            })

            let caption = `⌗ *Twitter Downloader*\n\n`
            caption += `› *Kualitas:* ${video.quality || 'Default'}\n\n`
            caption += `> *${config.botName}*`

            await sock.sendMessage(m.chat, {
                video: { stream },
                caption
            }, { quoted: m })

            await m.react('✅')
        } catch (e) {
            console.error(e)
            await m.react('❌')
            m.reply('Terjadi kesalahan saat mengunduh video Twitter.')
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

handler.command = __plugin.cmd || ['twitter', 'twt', 'x', 'xdl']
handler.help = __plugin.help || __plugin.cmd || ['twitter', 'twt', 'x', 'xdl']
handler.tags = [__plugin.category || 'downloader']
handler.heavy = true

export default handler
