import axios from 'axios'

const DOMAIN_TEST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d+)?([/?#].*)?$/i

async function screenshotWeb(url, options = {}) {
    const width = options.width || 1440
    const height = options.height || 1024
    const fullPage = options.fullPage !== false
    const darkMode = options.darkMode || false
    const format = options.format || 'png'

    const apiUrl = `https://image.thum.io/get/fullpage/${fullPage ? 'true' : 'false'}/width/${width}/height/${height}/${darkMode ? 'dark/true/' : ''}${url}`

    const response = await axios.get(apiUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    })

    return {
        buffer: Buffer.from(response.data),
        format: format
    }
}

const __plugin =  {
    cmd: ['ssweb', 'screenshot', 'ss'],
    category: 'tools',
    run: async (m, { sock, text }) => {
        if (!text) return m.reply('Masukkan URL website.\nContoh: .ssweb example.com')

        const args = text.trim().split(' ')
        let url = args[0]

        if (!/^https?:\/\//i.test(url)) {
            if (!DOMAIN_TEST.test(url)) return m.reply('URL tidak valid. Pastikan ada akhiran domain seperti .com atau .id')
            url = `https://${url}`
        }

        let options = {}
        if (args.includes('--dark')) options.darkMode = true
        if (args.includes('--mobile')) { options.width = 375; options.height = 812 }

        await m.reply('Sedang mengambil screenshot...')
        try {
            const { buffer } = await screenshotWeb(url, options)

            let caption = `Screenshot Web\nURL: ${url}`
            if (options.darkMode) caption += '\nMode: Dark'
            if (options.width === 375) caption += '\nMode: Mobile'

            await sock.sendMessage(m.chat, {
                image: buffer,
                caption
            }, { quoted: m })

        } catch (e) {
            m.reply(`Gagal mengambil screenshot: ${e.message}`)
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

handler.command = __plugin.cmd || ['ssweb', 'screenshot', 'ss']
handler.help = __plugin.help || __plugin.cmd || ['ssweb', 'screenshot', 'ss']
handler.tags = [__plugin.category || 'tools']

export default handler
