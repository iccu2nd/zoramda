const __plugin =  {
    cmd: ['goodbye'],
    category: 'group',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Khusus Grup!')
        if (!isAdmin) return m.reply('Khusus Admin Grup!')

        const chat = global.db.data.chats[m.chat]
        const action = text.split(' ')[0]?.toLowerCase()

        if (action === 'on') {
            chat.goodbye = true
            return m.reply('Goodbye Message berhasil diaktifkan!')
        } else if (action === 'off') {
            chat.goodbye = false
            return m.reply('Goodbye Message berhasil dimatikan!')
        } else if (action === 'set') {
            const newText = text.slice(3).trim()
            if (!newText) return m.reply('Masukan teks goodbye nya!')
            chat.goodbyeText = newText
            return m.reply('Teks Goodbye berhasil diubah!')
        } else {
            const status = chat.goodbye ? 'ON' : 'OFF'
            return m.reply(
                `⌗ *Goodbye System*\n\nStatus: *[ ${status} ]*\n\n› .goodbye on\n› .goodbye off\n› .goodbye set <teks>\n\n*Variables:*\n@pushname, @gcname, @desc, @date, @jam`
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

handler.command = __plugin.cmd || ['goodbye']
handler.help = __plugin.help || __plugin.cmd || ['goodbye']
handler.tags = [__plugin.category || 'group']

export default handler
