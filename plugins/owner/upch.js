const __plugin =  {
    cmd: ['upch', 'uploadch'],
    category: 'owner',
    run: async (m, { sock, text, config }) => {
        if (!m.isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')
        if (!config.idch) return m.reply('config.idch belum diset.')

        if (m.quoted) {
            const buffer = await m.download().catch((e) => { throw e })
            const caption = text || ''

            if (/^image/.test(buffer.mimetype)) {
                await sock.sendMessage(config.idch, { image: buffer, caption })
            } else if (/^video/.test(buffer.mimetype)) {
                await sock.sendMessage(config.idch, { video: buffer, caption })
            } else if (/^audio/.test(buffer.mimetype)) {
                await sock.sendMessage(config.idch, { audio: buffer, mimetype: buffer.mimetype, ptt: false })
            } else {
                return m.reply('Cuma bisa post gambar, video, atau audio/lagu.')
            }
            return m.reply('✅ Berhasil di-post ke channel.')
        }

        if (!text) return m.reply('Masukan teks yang mau di-post, atau reply gambar/video/audio.\nContoh: .upch Halo semua!')
        await sock.sendMessage(config.idch, { text })
        return m.reply('✅ Berhasil di-post ke channel.')
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

handler.command = __plugin.cmd || ['upch', 'uploadch']
handler.help = __plugin.help || __plugin.cmd || ['upch', 'uploadch']
handler.tags = [__plugin.category || 'owner']

export default handler
