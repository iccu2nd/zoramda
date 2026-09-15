import axios from 'axios'
import * as cheerio from 'cheerio'

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36'

const resolveUrl = (href) => {
  if (!href) return null
  if (href.startsWith('//')) return 'https:' + href
  return href
}

const filenameFromUrl = (url) => {
  const match = url.match(/\/file\/[^/]+\/([^/]+)\/file/)
  return match ? decodeURIComponent(match[1]) : null
}

const getExt = (filename) => filename.split('.').pop().toLowerCase()

const mediafire = async (url) => {
  if (!/mediafire\.com\/file\//.test(url)) throw new Error('Link MediaFire tidak valid')

  const fetchPage = async (target) => {
    const { data } = await axios.get(target, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 30000
    })
    return cheerio.load(data)
  }

  let $ = await fetchPage(url)
  let downloadUrl = resolveUrl($('#downloadButton').attr('href'))

  if (downloadUrl && /mediafire\.com\/file\//.test(downloadUrl)) {
    $ = await fetchPage(downloadUrl)
    downloadUrl = resolveUrl($('#downloadButton').attr('href'))
  }

  if (!downloadUrl) throw new Error('Tombol download tidak ditemukan')

  const filename = filenameFromUrl(url) ||
    $('div.dl-btn-label').attr('title') ||
    $('meta[property="og:title"]').attr('content') ||
    'file'

  const sizeMatch = $('#downloadButton').text().match(/\(([^)]+)\)/)
  const size = sizeMatch ? sizeMatch[1] : null
  const ext = getExt(filename)
  const isZip = ['zip', 'rar', '7z'].includes(ext)
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)
  const isVideo = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext)
  const isAudio = ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg'].includes(ext)
  const isApk = ext === 'apk'

  return { filename, size, url: downloadUrl, ext, isZip, isImage, isVideo, isAudio, isApk }
}

const buildCaption = (data, botName) => {
  const lines = ['MEDIAFIRE DOWNLOADER', '', 'Nama: ' + data.filename]
  if (data.size) lines.push('Ukuran: ' + data.size)
  lines.push('', '> ' + botName)
  return lines.join('\n')
}

const __plugin =  {
  cmd: ['mediafire', 'mf'],
  category: 'downloader',
  description: 'Download file dari MediaFire',

  run: async (m, { sock, text, config }) => {
    if (!text) return m.reply('Masukan link MediaFire')
    if (!/mediafire\.com\/file\//.test(text)) return m.reply('Link tidak valid')
    await m.react('⏳')

    try {
      const data = await mediafire(text)
      const caption = buildCaption(data, config.botName)

      if (data.isImage) {
        await sock.sendMessage(m.chat, { image: { url: data.url }, caption }, { quoted: m })
      } else if (data.isVideo) {
        await sock.sendMessage(m.chat, { video: { url: data.url }, caption, mimetype: 'video/mp4' }, { quoted: m })
      } else if (data.isAudio) {
        await sock.sendMessage(m.chat, { audio: { url: data.url }, mimetype: 'audio/mpeg', fileName: data.filename, caption }, { quoted: m })
      } else if (data.isApk) {
        await sock.sendMessage(m.chat, { document: { url: data.url }, mimetype: 'application/vnd.android.package-archive', fileName: data.filename, caption }, { quoted: m })
      } else {
        await sock.sendMessage(m.chat, {
          document: { url: data.url },
          mimetype: data.isZip ? 'application/zip' : 'application/octet-stream',
          fileName: data.filename,
          caption
        }, { quoted: m })
      }

      await m.react('✅')
    } catch (e) {
      console.error(e)
      await m.react('❌')
      m.reply('Gagal: ' + e.message)
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

handler.command = __plugin.cmd || ['mediafire', 'mf']
handler.help = __plugin.help || __plugin.cmd || ['mediafire', 'mf']
handler.tags = [__plugin.category || 'downloader']
handler.heavy = true

export default handler
