const __plugin =  {
    cmd: ['antidelete', 'adelete'],
    category: 'group',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Khusus Grup!')
        if (!isAdmin) return m.reply('Khusus Admin Grup!')

        const chat = global.db.data.chats[m.chat]
        const action = text.split(' ')[0]?.toLowerCase()

        if (action === 'on') {
            chat.antidelete = true
            return m.reply('Antidelete berhasil diaktifkan!')
        } else if (action === 'off') {
            chat.antidelete = false
            return m.reply('Antidelete berhasil dimatikan!')
        } else {
            const status = chat.antidelete ? 'ON' : 'OFF'
            return m.reply(`⌗ *Antidelete System*\n\nStatus: *[ ${status} ]*\n\n› .antidelete on\n› .antidelete off`)
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

handler.command = __plugin.cmd || ['antidelete', 'adelete']
handler.help = __plugin.help || __plugin.cmd || ['antidelete', 'adelete']
handler.tags = [__plugin.category || 'group']

export default handler
