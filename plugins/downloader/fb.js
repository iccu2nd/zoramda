import * as cheerio from 'cheerio'

const BASE_URL = 'https://yt5s.io'

const fetchData = async (url) => {
  const timestamp = Math.floor(Date.now() / 1000)
  const headers = {
    'accept': '*/*',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'origin': BASE_URL,
    'referer': `${BASE_URL}/en20/facebook-downloader`,
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
    'cookie': `.AspNetCore.Culture=c%3Den%7Cuic%3Den; _ga=GA1.1.2011585369.${timestamp}; _ga_P5PP4YVN0Y=GS1.1.${timestamp}.4.1.${timestamp}.0.0.0`
  }

  const body = new URLSearchParams({ q: url, vt: 'facebook' }).toString()
  const response = await fetch(`${BASE_URL}/api/ajaxSearch/facebook`, { method: 'POST', headers, body })
  const json = await response.json()
  return json?.data || null
}

const parseData = (html) => {
  if (!html) return null
  const $ = cheerio.load(html)

  const img = $('div.image-fb img').attr('src') || ''
  const title = $('h3').text().trim() || ''
  const duration = $('p').eq(0).text().trim() || ''
  const links = $('a.download-link-fb').get().map(el => {
    const em = $(el)
    return {
      quality: em.closest('tr').find('.video-quality').text().trim() || '',
      url: em.attr('href') || ''
    }
  }).filter(v => v.url)

  return { img, title, duration, links }
}

const fbdown = async (url) => {
  const html = await fetchData(url)
  if (!html) throw new Error('Gagal mengambil data dari server')
  const data = parseData(html)
  if (!data) throw new Error('Gagal parsing data')
  return data
}

const __plugin =  {
  cmd: ['fb', 'fbdl', 'facebook'],
  category: 'downloader',
  description: 'Download video Facebook',

  run: async (m, { sock, text }) => {
    if (!text) return m.reply('Masukan URL Facebook')
    if (!/facebook\.com|fb\.watch/i.test(text)) return m.reply('Link tidak valid')
    await m.react('⏳')

    try {
      const data = await fbdown(text)
      if (!data.links.length) {
        await m.react('❌')
        return m.reply('Gagal mengambil link download')
      }

      const hd = data.links.find(x => /hd/i.test(x.quality))
      const sd = data.links.find(x => /sd/i.test(x.quality))
      const video = hd || sd || data.links[0]

      await sock.sendVideo(m.chat, video.url, data.title || '', m)
      await m.react('✅')
    } catch (e) {
      console.error(e)
      await m.react('❌')
      m.reply('Terjadi kesalahan saat mengambil data dari Facebook')
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

handler.command = __plugin.cmd || ['fb', 'fbdl', 'facebook']
handler.help = __plugin.help || __plugin.cmd || ['fb', 'fbdl', 'facebook']
handler.tags = [__plugin.category || 'downloader']
handler.heavy = true

export default handler
