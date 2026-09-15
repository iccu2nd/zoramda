const __plugin =  {
    cmd: ['welcome'],
    category: 'group',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Khusus Grup!')
        if (!isAdmin) return m.reply('Khusus Admin Grup!')

        const chat = global.db.data.chats[m.chat]
        const action = text.split(' ')[0]?.toLowerCase()

        if (action === 'on') {
            chat.welcome = true
            return m.reply('Welcome Message berhasil diaktifkan!')
        } else if (action === 'off') {
            chat.welcome = false
            return m.reply('Welcome Message berhasil dimatikan!')
        } else if (action === 'set') {
            const newText = text.slice(3).trim()
            if (!newText) return m.reply('Masukan teks welcome nya!')
            chat.welcomeText = newText
            return m.reply('Teks Welcome berhasil diubah!')
        } else {
            const status = chat.welcome ? 'ON' : 'OFF'
            return m.reply(
                `⌗ *Welcome System*\n\nStatus: *[ ${status} ]*\n\n› .welcome on\n› .welcome off\n› .welcome set <teks>\n\n*Variables:*\n@pushname, @gcname, @desc, @date, @jam`
            )
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

handler.command = __plugin.cmd || ['welcome']
handler.help = __plugin.help || __plugin.cmd || ['welcome']
handler.tags = [__plugin.category || 'group']

export default handler
