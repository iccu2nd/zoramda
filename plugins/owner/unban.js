const __plugin =  {
    cmd: ['unban'],
    category: 'owner',
    run: async (m, { sock, text }) => {
        if (!m.isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')

        const target = m.mentionedJid?.[0] || m.quoted?.sender || (text?.replace(/[^0-9]/g, '').length >= 10 ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null)
        if (!target) return m.reply('Tag, reply, atau masukan nomor.\nContoh: .unban @user\natau: .unban 628xxxx')

        if (!global.db.data.users[target]) global.db.data.users[target] = {}
        const user = global.db.data.users[target]

        if (!user.banned) return m.reply(`@${target.split('@')[0]} tidak sedang di-ban.`, { mentions: [target] })
        user.banned = false
        return sock.sendMessage(m.chat, { text: `✅ @${target.split('@')[0]} telah di-unban.`, mentions: [target] }, { quoted: m })
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

handler.command = __plugin.cmd || ['unban']
handler.help = __plugin.help || __plugin.cmd || ['unban']
handler.tags = [__plugin.category || 'owner']

export default handler
