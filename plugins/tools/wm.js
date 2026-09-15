const __plugin =  {
    cmd: ['wm', 'take', 'colong'],
    category: 'tools',
    run: async (m, { sock, text }) => {
        if (!m.quoted) return m.reply("Silakan balas/reply stiker yang ingin diubah watermark-nya.")

        if (m.quoted.type !== 'stickerMessage') return m.reply("Fitur ini hanya dapat digunakan dengan membalas sebuah stiker.")

        const [pack, auth] = (text || '').split('|').map(v => v.trim())

        await m.react('⏳')

        try {
            const buffer = await m.download()

            await sock.sendSticker(m.chat, buffer, m, {
                packname: pack || '',
                author: auth || ''
            })

            await m.react('✅')
        } catch (e) {
            await m.react('❌')
            m.reply(`Gagal mengubah watermark stiker: ${e.message}`)
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

handler.command = __plugin.cmd || ['wm', 'take', 'colong']
handler.help = __plugin.help || __plugin.cmd || ['wm', 'take', 'colong']
handler.tags = [__plugin.category || 'tools']

export default handler
