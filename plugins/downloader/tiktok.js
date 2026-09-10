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

const ttdown = async (url) => {
  if (!/tiktok\.com/.test(url)) throw new Error('URL tidak valid')
  const { data } = await axios.get(API_URL, {
    params: { url, hd: 1 },
    headers: { 'User-Agent': USER_AGENT },
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
    lines.push('- Total Foto: ' + data.images.length)
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
  if (!text) {
    return m.reply(`Masukkan link TikTok.\nContoh: *${usedPrefix + command} https://vt.tiktok.com/xxxxx*`)
  }
  if (!/tiktok\.com/.test(text)) {
    return m.reply('Link tidak valid, harus link TikTok.')
  }

  await m.react('🕐')

  try {
    const data = await ttdown(text)
    const caption = buildCaption(data, config.get('botName') || 'Botenv')

    if (data.type === 'slide') {
      if (!data.images.length) {
        await m.react('❌')
        return m.reply('Gagal mengambil gambar.')
      }
      await m.reply(caption)
      const album = data.images.map((url) => ({ image: { url } }))
      await conn.sendAlbum(m.chat, album, { quoted: m.raw })
      if (data.music) {
        await conn.sendAudio(m.chat, data.music, false, m.raw)
      }
    } else {
      if (!data.video) {
        await m.react('❌')
        return m.reply('Gagal mengambil link download video.')
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
  } catch (err) {
    await m.react('❌')
    await m.reply(`❌ Gagal: ${err.message}`)
    throw err
  }
}

handler.help = ['tiktok <url>', 'tt <url>', 'ttdl <url>']
handler.tags = ['downloader']
handler.command = ['tiktok', 'tt', 'ttdl']
handler.permission = 'everyone'
handler.heavy = true

export default handler
