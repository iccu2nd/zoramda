import axios from 'axios'

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

/** Provider utama: tikwm.com */
async function fromTikwm(url) {
  const { data } = await axios.get('https://www.tikwm.com/api/', {
    params: { url, hd: 1 },
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://www.tikwm.com/',
      Accept: 'application/json, text/plain, */*',
    },
    timeout: 30000,
  })
  if (!data || data.code !== 0 || !data.data) {
    throw new Error(data?.msg || 'tikwm: gagal mengambil data')
  }
  const d = data.data
  const isSlide = Array.isArray(d.images) && d.images.length > 0
  return {
    type: isSlide ? 'slide' : 'video',
    title: (d.title || '').trim(),
    author: { username: d.author?.unique_id || '-', nickname: d.author?.nickname || '-' },
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
 * Provider cadangan: tiklydown.eu.org — dipakai otomatis kalau tikwm
 * gagal/kena block (403). Parsing dibikin defensif (banyak fallback nama
 * field) karena API publik gini suka ganti-ganti struktur response.
 */
async function fromTiklydown(url) {
  const { data } = await axios.get('https://tiklydown.eu.org/api/download', {
    params: { url },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 30000,
  })
  const r = data?.result || data?.data
  if (!r) throw new Error('tiklydown: gagal mengambil data')

  const images = r.images || r.image_list || r.slides || []
  const isSlide = Array.isArray(images) && images.length > 0
  const video =
    r.video?.no_watermark || r.video?.noWatermark || r.video?.play || r.video?.download || r.video_url || null
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
    images,
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
  if (!/tiktok\.com/.test(url)) throw new Error('URL tidak valid')

  try {
    return await fromTikwm(url)
  } catch (err) {
    // tikwm sering nge-block IP datacenter/VPS (403) — coba provider cadangan
    try {
      const result = await fromTiklydown(url)
      if (!result.video && !result.images.length) {
        throw new Error('response kosong')
      }
      return result
    } catch (err2) {
      throw new Error(`Semua provider gagal.\n- tikwm: ${err.message}\n- tiklydown: ${err2.message}`)
    }
  }
}

const buildCaption = (data, botName) => {
  const lines = ['', data.title || '-', '', '- Author: ' + data.author.nickname + ' (@' + data.author.username + ')']
  if (data.type === 'video') lines.push('- Durasi: ' + formatDuration(data.duration))
  else lines.push('- Total Foto: ' + data.images.length)
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
      if (data.music) await conn.sendAudio(m.chat, data.music, false, m.raw)
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
      if (data.music) await conn.sendAudio(m.chat, data.music, false, m.raw)
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
handler.heavy = true

export default handler
