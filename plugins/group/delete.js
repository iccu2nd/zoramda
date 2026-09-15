const __plugin =  {
    cmd: ['delete', 'del'],
    category: 'group',
    run: async (m, { sock, isBotAdmin, config }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!m.quoted) return m.reply('Reply pesan yang ingin dihapus!')

        if (!m.quoted.fromMe && !isBotAdmin) return m.reply('Bot harus menjadi admin untuk menghapus pesan member lain.')

        try {
            await sock.sendMessage(m.chat, {
                delete: {
                    remoteJid: m.chat,
                    fromMe: m.quoted.fromMe,
                    id: m.quoted.id,
                    participant: m.quoted.sender
                }
            })
        } catch (e) {
            console.error(e)
            m.reply('Gagal menghapus pesan. Pastikan bot adalah admin.')
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

handler.command = __plugin.cmd || ['delete', 'del']
handler.help = __plugin.help || __plugin.cmd || ['delete', 'del']
handler.tags = [__plugin.category || 'group']

export default handler
