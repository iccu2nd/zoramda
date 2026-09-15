const __plugin =  {
    cmd: ['listban'],
    category: 'owner',
    description: 'Lihat daftar user yang di-ban',
    run: async (m, { config, isOwner }) => {
        if (!isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')

        const users = global.db.data.users || {}
        const list = Object.entries(users).filter(([, u]) => u.banned)

        if (!list.length) return m.reply(`Tidak ada user yang di-ban saat ini.\n\n> *${config.botName}*`)

        const lines = list.map(([jid], i) => `${i + 1}. @${jid.split('@')[0]}`).join('\n')

        return m.reply(`🚫 *DAFTAR USER BANNED*\n\n${lines}\n\nTotal: *${list.length} user*\nBuka ban dengan .unban <nomor/tag>\n> *${config.botName}*`, {
            mentions: list.map(([jid]) => jid)
        })
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

handler.command = __plugin.cmd || ['listban']
handler.help = __plugin.help || __plugin.cmd || ['listban']
handler.tags = [__plugin.category || 'owner']

export default handler
