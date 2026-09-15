const __plugin =  {
    cmd: ['unblacklist', 'ubl'],
    category: 'group',
    description: 'Hapus user dari blacklist',

    run: async (m, { config, isAdmin, isBotAdmin, prefix }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya bisa digunakan di grup.')
        if (!isAdmin && !m.isOwner) return m.reply('Hanya admin yang bisa menggunakan perintah ini.')
        if (!isBotAdmin) return m.reply('Bot harus jadi admin dulu agar bisa hapus pesan.')

        const chat = global.db.data.chats[m.chat]
        if (!chat.blacklist) chat.blacklist = []

        const mentioned = m.mentionedJid?.[0] || m.quoted?.sender
        if (!mentioned) return m.reply(`Tag atau reply pesan user yang mau di-unblacklist!\nContoh: *${prefix}ubl @user*`)

        const numOnly = mentioned.split('@')[0]

        const before = chat.blacklist.length
        chat.blacklist = chat.blacklist.filter(j => j.split('@')[0] !== numOnly)
        if (chat.blacklist.length === before) return m.reply(`@${numOnly} tidak ada di blacklist.`)

        return m.reply(`✅ *@${numOnly} dihapus dari blacklist!*\n\nPesan mereka tidak akan dihapus lagi.\n\n> *${config.botName}*`)
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

handler.command = __plugin.cmd || ['unblacklist', 'ubl']
handler.help = __plugin.help || __plugin.cmd || ['unblacklist', 'ubl']
handler.tags = [__plugin.category || 'group']

export default handler
