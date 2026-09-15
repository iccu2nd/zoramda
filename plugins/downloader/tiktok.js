import axios from 'axios'

const API_URL = 'https://www.tikwm.com/api/'
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36'

const formatNumber = (n) => {
  n = Number(n) || 0
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

const formatDuration = (s) => {
  s = Number(s) || 0
  const m = Math.floor(s / 60)
  const r = s % 60
  return m + ':' + String(r).padStart(2, '0')
}

function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s]+/i)
  return m ? m[0].replace(/[)\]}>'",.]+$/, '') : String(text || '').trim()
}

/** Provider utama: tikwm.com */
async function fromTikwm(url) {
  const { data } = await axios.get(API_URL, {
    params: { url, hd: 1 },
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.tikwm.com/',
      Accept: 'application/json, text/plain, */*',
    },
    timeout: 30000,
  })
  if (!data || data.code !== 0 || !data.data) {
    throw new Error(data?.msg || 'Gagal mengambil data')
  }
  const d = data.data
  const isSlide = Array.isArray(d.images) && d.images.length > 0
  return {
    type: isSlide ? 'slide' : 'video',
    title: (d.title || '').trim(),
    author: {
      username: d.author?.unique_id || '-',
      nickname: d.author?.nickname || '-',
    },
    video: d.hdplay || d.play || null,
    music: d.music || null,
    images: isSlide ? d.images : [],
    duration: d.duration || 0,
    stats: {
      plays: d.play_count || 0,
      likes: d.digg_count || 0,
      comments: d.comment_count || 0,
      shares: d.share_count || 0,
    },
  }
}

/**
 * Cadangan jika tikwm gagal / 403 (sering di VPS).
 */
async function fromTiklydown(url) {
  const { data } = await axios.get('https://tiklydown.eu.org/api/download', {
    params: { url },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 30000,
  })
  const r = data?.result || data?.data
  if (!r) throw new Error('Provider cadangan gagal')

  const images = r.images || r.image_list || r.slides || []
  const isSlide = Array.isArray(images) && images.length > 0
  const video =
    r.video?.no_watermark ||
    r.video?.noWatermark ||
    r.video?.play ||
    r.video?.download ||
    r.video_url ||
    null
  const music = r.music?.play || r.music?.url || r.music_url || r.audio || null
  const stats = r.stats || {}

  return {
    type: isSlide ? 'slide' : 'video',
    title: (r.title || r.desc || '').trim(),
    author: {
      username: r.author?.username || r.author?.unique_id || '-',
      nickname: r.author?.nickname || r.author?.name || '-',
    },
    video,
    music,
    images: isSlide ? images : [],
    duration: r.duration || 0,
    stats: {
      plays: stats.playCount || stats.play_count || 0,
      likes: stats.diggCount || stats.digg_count || stats.likeCount || 0,
      comments: stats.commentCount || stats.comment_count || 0,
      shares: stats.shareCount || stats.share_count || 0,
    },
  }
}

const ttdown = async (url) => {
  if (!/tiktok\.com/i.test(url)) throw new Error('Invalid url')
  try {
    return await fromTikwm(url)
  } catch (err) {
    try {
      const result = await fromTiklydown(url)
      if (!result.video && !(result.images && result.images.length)) {
        throw new Error('Response kosong')
      }
      return result
    } catch (err2) {
      throw new Error(err?.message || err2?.message || 'Gagal mengambil data')
    }
  }
}

const buildCaption = (data, botName) => {
  const lines = [
    '',
    data.title || '-',
    '',
    '- Author: ' + data.author.nickname + ' (@' + data.author.username + ')',
  ]
  if (data.type === 'video') {
    lines.push('- Durasi: ' + formatDuration(data.duration))
  } else {
    lines.push('- Total Foto: ' + (data.images?.length || 0))
  }
  lines.push(
    '- Ditonton: ' + formatNumber(data.stats.plays),
    '- Suka: ' + formatNumber(data.stats.likes),
    '- Komentar: ' + formatNumber(data.stats.comments),
    '- Dibagikan: ' + formatNumber(data.stats.shares),
    '',
    '> ' + botName
  )
  return lines.join('\n')
}

let handler = async (m, { conn, text, usedPrefix, command, config }) => {
  const url = extractUrl(text)
  if (!url) {
    return m.reply(`Masukan URL TikTok\nContoh: *${usedPrefix}${command} https://vt.tiktok.com/xxxxx*`)
  }
  if (!/tiktok\.com/i.test(url)) {
    return m.reply('Link tidak valid')
  }

  await m.react('⏳')

  try {
    const data = await ttdown(url)
    const botName =
      (typeof config?.get === 'function' ? config.get('botName') : null) ||
      config?.botName ||
      'Botenv'
    const caption = buildCaption(data, botName)

    if (data.type === 'slide') {
      if (!data.images?.length) {
        await m.react('❌')
        return m.reply('Gagal mengambil gambar')
      }
      await m.reply(caption)
      const album = data.images.map((img) => ({ image: { url: img } }))
      await conn.sendAlbum(m.chat, album, { quoted: m.raw })
      if (data.music) {
        await conn.sendAudio(m.chat, data.music, false, m.raw)
      }
    } else {
      if (!data.video) {
        await m.react('❌')
        return m.reply('Gagal mengambil link download')
      }
      await conn.sendMessage(
        m.chat,
        { video: { url: data.video }, caption, mimetype: 'video/mp4' },
        { quoted: m.raw }
      )
      if (data.music) {
        await conn.sendAudio(m.chat, data.music, false, m.raw)
      }
    }

    await m.react('✅')
  } catch (e) {
    await m.react('❌')
    await m.reply('Error: ' + (e?.message || 'Gagal'))
  }
}

handler.help = ['tiktok <url>', 'tt <url>', 'ttdl <url>']
handler.tags = ['downloader']
handler.command = ['tiktok', 'tt', 'ttdl']
handler.heavy = true

export default handler
