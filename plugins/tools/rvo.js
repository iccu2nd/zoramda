const __plugin =  {
    cmd: ['rvo'],
    category: 'tools',
    run: async (m, { sock }) => {
        if (!m.quoted) return m.reply('Reply ke pesan sekali lihat!')

        const buffer = await m.download().catch(() => null)
        if (!buffer || !/image|video|audio/.test(buffer.mimetype)) {
            return m.reply('Hanya untuk foto/video/audio sekali lihat.')
        }

        try {
            if (/image/.test(buffer.mimetype)) {
                await sock.sendImage(m.chat, buffer, buffer.caption || '', m)
            } else if (/video/.test(buffer.mimetype)) {
                await sock.sendVideo(m.chat, buffer, buffer.caption || '', m)
            } else {
                await sock.sendAudio(m.chat, buffer, true, m)
            }
        } catch (e) {
            console.error(e)
            m.reply('Gagal membuka pesan. Mungkin sudah kadaluarsa.')
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

handler.command = __plugin.cmd || ['rvo']
handler.help = __plugin.help || __plugin.cmd || ['rvo']
handler.tags = [__plugin.category || 'tools']

export default handler
