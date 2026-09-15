const __plugin =  {
    cmd: ['ssweb2'],
    category: 'tools',
    run: async (m, { sock, text, config }) => {
        if (!text) return m.reply('Masukkan URL!\nContoh: .ssweb google.com')

        const url = /^https?:\/\//i.test(text) ? text : `https://${text}`

        m.reply('⌛ Sedang mengambil screenshot...')

        try {
            const image = `https://api.mightyshare.io/v1/19EIFDUEL496RA3F/jpg?url=${encodeURIComponent(url)}`

            let caption = `⌗ *Website Screenshot*\n\n`
            caption += `› *URL:* ${url}\n\n`
            caption += `> *${config.botName}*`

            await sock.sendMessage(m.chat, { image: { url: image }, caption }, { quoted: m })
        } catch (e) {
            console.error(e)
            m.reply('Terjadi kesalahan saat mengambil screenshot.')
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

handler.command = __plugin.cmd || ['ssweb2']
handler.help = __plugin.help || __plugin.cmd || ['ssweb2']
handler.tags = [__plugin.category || 'tools']

export default handler
