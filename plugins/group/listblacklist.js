const __plugin =  {
    cmd: ['listblacklist'],
    category: 'group',
    description: 'Lihat daftar blacklist grup',

    run: async (m, { config }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya bisa digunakan di grup.')

        const chat = global.db.data.chats[m.chat]
        const list = chat?.blacklist || []
        if (!list.length) return m.reply('Blacklist grup ini kosong.')

        const names = list.map((jid, i) => `${i + 1}. @${jid.split('@')[0]}`).join('\n')
        return m.reply(`*BLACKLIST GRUP*\n\n${names}\n\nTotal: *${list.length} user*\n> *${config.botName}*`)
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

handler.command = __plugin.cmd || ['listblacklist']
handler.help = __plugin.help || __plugin.cmd || ['listblacklist']
handler.tags = [__plugin.category || 'group']

export default handler
