const __plugin =  {
    cmd: ['listprem'],
    category: 'owner',
    description: 'Lihat daftar user premium',
    run: async (m, { config, isOwner }) => {
        if (!isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')

        const now = Date.now()
        const users = global.db.data.users || {}
        const list = Object.entries(users)
            .filter(([, u]) => u.premium && u.premiumTime > now)
            .sort((a, b) => a[1].premiumTime - b[1].premiumTime)

        if (!list.length) return m.reply(`Belum ada user premium saat ini.\n\n> *${config.botName}*`)

        const lines = list.map(([jid, u], i) => {
            const expire = new Date(u.premiumTime).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
            return `${i + 1}. @${jid.split('@')[0]} — hingga ${expire}`
        }).join('\n')

        return m.reply(`💎 *DAFTAR USER PREMIUM*\n\n${lines}\n\nTotal: *${list.length} user*\n> *${config.botName}*`, {
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

handler.command = __plugin.cmd || ['listprem']
handler.help = __plugin.help || __plugin.cmd || ['listprem']
handler.tags = [__plugin.category || 'owner']

export default handler
