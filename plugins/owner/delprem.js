const __plugin =  {
    cmd: ['delprem'],
    category: 'owner',
    run: async (m, { sock }) => {
        if (!m.isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')

        const target = m.mentionedJid?.[0] || m.quoted?.sender
        if (!target) return m.reply('Tag atau reply user.\nContoh: .delprem @user\natau reply pesan lalu: .delprem')

        const user = global.db.data.users[target]
        if (!user) return m.reply('User tidak ditemukan di database.')
        if (!user.premium) return m.reply('User tersebut bukan member premium.')

        user.premium = false
        user.premiumTime = 0

        await sock.sendMessage(m.chat, {
            text: `Status premium @${target.split('@')[0]} telah dihapus.`,
            mentions: [target]
        }, { quoted: m })
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

handler.command = __plugin.cmd || ['delprem']
handler.help = __plugin.help || __plugin.cmd || ['delprem']
handler.tags = [__plugin.category || 'owner']

export default handler
