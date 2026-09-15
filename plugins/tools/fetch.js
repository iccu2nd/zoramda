import path from 'path'

const _cache = new Map()
const CACHE_TTL = 5 * 60_000

const getCache = (url) => {
    const hit = _cache.get(url)
    if (!hit || Date.now() - hit.ts > CACHE_TTL) { _cache.delete(url); return null }
    return hit
}

const setCache = (url, data) => {
    if (data.buf.length > 5 * 1024 * 1024) return
    if (_cache.size >= 32) _cache.delete([..._cache.keys()][0])
    _cache.set(url, { ...data, ts: Date.now() })
}

const extractUrl = (text) => {
    if (!text) return null
    const m = text.match(/https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/)
    return m ? m[0] : null
}

const isWebpBuf = (buf) =>
    buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 &&
    buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|opus|aac|flac)$/i

const isMp3Buf = (buf) =>
    (buf[0]===0x49 && buf[1]===0x44 && buf[2]===0x33) ||
    (buf[0]===0xFF && (buf[1]===0xFB || buf[1]===0xF3 || buf[1]===0xF2))

const __plugin =  {
    cmd: ['fetch', 'get'],
    category: 'tools',
    run: async (m, { sock, text }) => {
        let raw = text?.trim() || extractUrl(m.quoted?.text || m.quoted?.caption || '')

        if (!raw) return m.reply(
            `Fetch URL\n\nContoh:\n.fetch data.bmkg.go.id/DataMKG/TEWS/autogempa.json\n`
        )

        await m.react('⏳')

        try {
            if (!/^https?:\/\//.test(raw)) raw = 'http://' + raw
            const url = new URL(raw).href

            let buf, contentType, filename
            const cached = getCache(url)

            if (cached) {
                ({ buf, contentType, filename } = cached)
            } else {
                const res = await fetch(url)
                contentType = res.headers.get('content-type') || ''
                const cd = res.headers.get('content-disposition') || ''
                filename = cd.includes('filename=')
                    ? cd.split('filename=')[1].replace(/["']/g, '').trim()
                    : path.basename(url) || 'file'
                buf = Buffer.from(await res.arrayBuffer())
                setCache(url, { buf, contentType, filename })
            }

            if (isWebpBuf(buf) || /\.webp$/i.test(filename)) {
                await sock.sendSticker(m.chat, buf, m, {
                    packname: 'Nerd Bot',
                    author: 'fetch',
                    isAnimated: false
                })
            } else if (/^image\//.test(contentType)) {
                await sock.sendMessage(m.chat, { image: buf, caption: url }, { quoted: m })
            } else if (/^audio\//.test(contentType) || AUDIO_EXT.test(filename) || isMp3Buf(buf)) {
                await sock.sendAudio(m.chat, buf, false, m)
            } else if (/^video\//.test(contentType)) {
                await sock.sendMessage(m.chat, { video: buf, mimetype: contentType.split(';')[0].trim(), caption: filename }, { quoted: m })
            } else if (/^application\/json/.test(contentType)) {
                await m.reply(JSON.stringify(JSON.parse(buf.toString()), null, 2))
            } else if (/^text\/html/.test(contentType)) {
                await m.reply(buf.toString().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000))
            } else if (/^text\//.test(contentType)) {
                await m.reply(buf.toString().slice(0, 4000))
            } else {
                await sock.sendMessage(m.chat, { document: buf, mimetype: contentType || 'application/octet-stream', fileName: filename }, { quoted: m })
            }

            await m.react('✅')
        } catch (e) {
            console.error(e)
            await m.react('❌')
            m.reply(`Error: ${e.message}`)
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

handler.command = __plugin.cmd || ['fetch', 'get']
handler.help = __plugin.help || __plugin.cmd || ['fetch', 'get']
handler.tags = [__plugin.category || 'tools']

export default handler
