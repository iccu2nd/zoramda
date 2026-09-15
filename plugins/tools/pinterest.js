import https from 'https'
import { prepareWAMessageMedia } from '@whiskeysockets/baileys'

const getPinterestAuth = () => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'id.pinterest.com',
            path: '/',
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            },
        }

        https.get(options, (res) => {
            const cookies = res.headers['set-cookie']
            if (cookies) {
                const csrfCookie = cookies.find(cookie => cookie.startsWith('csrftoken='))
                const pinterestSessCookie = cookies.find(cookie => cookie.startsWith('_pinterest_sess='))

                if (csrfCookie && pinterestSessCookie) {
                    const csrftoken = csrfCookie.split(';')[0].split('=')[1]
                    const sess = pinterestSessCookie.split(';')[0]
                    resolve({ csrftoken, cookieHeader: `csrftoken=${csrftoken}; ${sess}` })
                    return
                }
            }
            reject(new Error('Gagal mendapatkan auth token.'))
        }).on('error', e => reject(e))
    })
}

const pinterest = async (query, limit = 1) => {
    const { csrftoken, cookieHeader } = await getPinterestAuth()
    let results = []
    let bookmark = null

    while (results.length < limit) {
        const postData = {
            options: {
                query: query,
                scope: 'pins',
                bookmarks: bookmark ? [bookmark] : [],
            },
            context: {},
        }

        const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`
        const dataString = `source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(postData))}`

        const options = {
            hostname: 'id.pinterest.com',
            path: '/resource/BaseSearchResource/get/',
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/javascript, */*, q=0.01',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrftoken,
                'X-Pinterest-Source-Url': sourceUrl,
                'Cookie': cookieHeader,
            },
        }

        const responseBody = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let body = ''
                res.on('data', chunk => (body += chunk))
                res.on('end', () => resolve(body))
            })
            req.on('error', e => reject(e))
            req.write(dataString)
            req.end()
        })

        const jsonResponse = JSON.parse(responseBody)
        if (jsonResponse.resource_response?.data?.results) {
            const pins = jsonResponse.resource_response.data.results
            pins.forEach(pin => {
                const url = pin.images['736x']?.url || pin.images['orig']?.url
                if (url) results.push(url)
            })

            bookmark = jsonResponse.resource_response.bookmark
            if (!bookmark || pins.length === 0) break
        } else {
            break
        }
    }
    return results.slice(0, limit)
}

const __plugin =  {
    cmd: ['pin', 'pinterest'],
    category: 'tools',
    run: async (m, { sock, text, config, prefix, cmd }) => {
        if (!text) return m.reply('Masukkan query pencarian!\nContoh: .pin kaguya 5')

        let args = text.split(' ')
        let lastArg = args[args.length - 1]
        let count = parseInt(lastArg)
        let query = text

        if (!isNaN(count)) {
            query = args.slice(0, -1).join(' ')
        } else {
            count = 1
        }

        if (count > 10) return m.reply('Maksimal 10 gambar.')

        m.reply('⌛ Sedang mencari gambar...')

        try {
            if (count === 1) {
                const pool = await pinterest(query, 10)
                if (!pool.length) return m.reply('Gambar tidak ditemukan.')
                const randomImage = pool[Math.floor(Math.random() * pool.length)]

                let caption = `⌗ *Pinterest Search*\n\n`
                caption += `› *Query:* ${query}\n\n`
                caption += `> *${config.botName}*`

                const { imageMessage } = await prepareWAMessageMedia(
                    { image: { url: randomImage } },
                    { upload: sock.waUploadToServer }
                )

                await sock.sendButtonV2(m.chat, {
                    body: caption,
                    footer: config.botName,
                    media: { headerType: 4, imageMessage },
                    buttons: [
                        { label: '🔀 Gambar Lain', id: `${prefix || '.'}${cmd} ${query}` }
                    ]
                }, { quoted: m })
                return
            }

            const results = await pinterest(query, count)
            if (!results.length) return m.reply('Gambar tidak ditemukan.')

            let caption = `⌗ *Pinterest Search*\n\n`
            caption += `› *Query:* ${query}\n`
            caption += `› *Jumlah:* ${results.length}\n\n`
            caption += `> *${config.botName}*`

            let album = results.map(url => ({ image: { url } }))
            await m.reply(caption)
            await sock.sendAlbum(m.chat, album, { quoted: m })

        } catch (e) {
            console.error(e)
            m.reply('Terjadi kesalahan saat mencari gambar.')
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
    sock, conn, text, args, prefix, usedPrefix, command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin, cmd: command,
  })
}

handler.command = __plugin.cmd || ['pin', 'pinterest']
handler.help = __plugin.help || __plugin.cmd || ['pin', 'pinterest']
handler.tags = [__plugin.category || 'tools']

export default handler
