const __plugin =  {
    cmd: ['setmaxwarn'],
    category: 'group',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const chat = global.db.data.chats[m.chat]
        const maxWarn = chat.maxWarn || 3

        const value = parseInt(text)
        if (!value || value < 1) return m.reply(`Gunakan: .setmaxwarn <angka>\nBatas saat ini: ${maxWarn}`)
        chat.maxWarn = value
        return m.reply(`✅ Batas warn di grup ini diubah jadi ${value}.`)
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

handler.command = __plugin.cmd || ['setmaxwarn']
handler.help = __plugin.help || __plugin.cmd || ['setmaxwarn']
handler.tags = [__plugin.category || 'group']

export default handler
