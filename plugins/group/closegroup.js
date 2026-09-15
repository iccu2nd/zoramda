const __plugin =  {
    cmd: ['close', 'tutup', 'closegroup'],
    category: 'group',
    run: async (m, { sock, isAdmin, isBotAdmin }) => {
        if (!m.isGroup) return m.reply("Fitur ini hanya dapat digunakan di dalam grup.")
        if (!isAdmin) return m.reply("Hanya admin grup yang dapat menggunakan perintah ini.")
        if (!isBotAdmin) return m.reply("Bot harus menjadi admin untuk mengubah setelan grup.")
        try {
            await sock.groupSettingUpdate(m.chat, 'announcement')
            return m.reply("Berhasil menutup grup. Sekarang hanya admin yang dapat mengirimkan pesan.")
        } catch (e) {
            m.reply("Gagal menutup grup.")
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

handler.command = __plugin.cmd || ['close', 'tutup', 'closegroup']
handler.help = __plugin.help || __plugin.cmd || ['close', 'tutup', 'closegroup']
handler.tags = [__plugin.category || 'group']

export default handler
