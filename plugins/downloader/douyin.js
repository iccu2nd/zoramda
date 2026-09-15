import * as cheerio from 'cheerio'

const BASE_URL = 'https://tikvideo.app'
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'

const douyin = async (url) => {
  const body = new URLSearchParams({ q: url, lang: 'id', cftoken: '' }).toString()
  const response = await fetch(`${BASE_URL}/api/ajaxSearch`, {
    method: 'POST',
    headers: {
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/id/douyin-downloader`,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body
  })
  const raw = await response.text()
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Respons tidak valid dari server (status ${response.status})`)
  }
  if (json.status !== 'ok') throw new Error(json.msg || 'Gagal mendapatkan data dari Douyin')
  if (typeof json.data !== 'string' || !json.data.trim()) {
    throw new Error('Data HTML kosong atau tidak valid dari server')
  }
  const $ = cheerio.load(json.data)
  const title = $('.tik-video .content h3').first().text().trim()
  const downloadLinks = []
  $('.tik-video .dl-action a').each((i, link) => {
    const el = $(link)
    if (el.hasClass('action-convert')) return
    const href = el.attr('href')
    if (href) {
      downloadLinks.push({ title: el.text().trim(), url: href })
    }
  })
  const photos = []
  $('.photo-list .download-items').each((i, item) => {
    const url = $(item).find('.download-items__btn a').attr('href')
    if (url) photos.push(url)
  })
  if (downloadLinks.length === 0 && photos.length === 0) {
    const videoSrc = $('video#vid').attr('data-src') || $('video source').attr('src')
    if (videoSrc) {
      downloadLinks.push({ title: 'Download MP4', url: videoSrc })
    }
  }
  return { title, downloadLinks, photos }
}

const __plugin =  {
  cmd: ['douyin', 'dy'],
  category: 'downloader',
  description: 'Download video/foto Douyin',
  run: async (m, { sock, text }) => {
    if (!text) return m.reply('Masukan URL Douyin')
    await m.react('⏳')
    try {
      const data = await douyin(text)
      const mp3 = data.downloadLinks.find(x => /mp3/i.test(x.title))
      const hd = data.downloadLinks.find(x => /hd/i.test(x.title))
      const mp4_2 = data.downloadLinks.find(x => /mp4 2/i.test(x.title))
      const mp4_1 = data.downloadLinks.find(x => /mp4 1/i.test(x.title))
      const video = hd || mp4_2 || mp4_1 || data.downloadLinks[0]
      if (video && video.url) {
        await sock.sendVideo(m.chat, video.url, data.title || '', m)
        if (mp3) await sock.sendAudio(m.chat, mp3.url, false, m)
      } else if (data.photos.length) {
        if (data.title) await m.reply(data.title)
        if (data.photos.length === 1) {
          await sock.sendMessage(m.chat, { image: { url: data.photos[0] } }, { quoted: m })
        } else {
          const album = data.photos.map(url => ({ image: { url } }))
          await sock.sendAlbum(m.chat, album, { quoted: m })
        }
        if (mp3) await sock.sendAudio(m.chat, mp3.url, false, m)
      } else {
        await m.react('❌')
        return m.reply('Tidak ada video/foto yang ditemukan')
      }
      await m.react('✅')
    } catch (e) {
      console.error(e)
      await m.react('❌')
      m.reply(`Terjadi kesalahan saat mengambil data dari Douyin\n${e.message}`)
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

handler.command = __plugin.cmd || ['douyin', 'dy']
handler.help = __plugin.help || __plugin.cmd || ['douyin', 'dy']
handler.tags = [__plugin.category || 'downloader']
handler.heavy = true

export default handler
