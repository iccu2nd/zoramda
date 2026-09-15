const __plugin =  {
    cmd: ['blacklist', 'bl'],
    category: 'group',
    description: 'Blacklist user - pesan otomatis dihapus',

    run: async (m, { sock, config, isAdmin, isBotAdmin, prefix }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya bisa digunakan di grup.')
        if (!isAdmin && !m.isOwner) return m.reply('Hanya admin yang bisa menggunakan perintah ini.')
        if (!isBotAdmin) return m.reply('Bot harus jadi admin dulu agar bisa hapus pesan.')

        const chat = global.db.data.chats[m.chat]
        if (!chat.blacklist) chat.blacklist = []

        const mentioned = m.mentionedJid?.[0] || m.quoted?.sender
        if (!mentioned) return m.reply(`Tag atau reply pesan user yang mau di-blacklist!\nContoh: *${prefix}bl @user*`)

        if (mentioned === m.sender) return m.reply('Tidak bisa blacklist diri sendiri.')

        const botJid = sock.user?.id?.replace(/:\d+@.+/, '') + '@s.whatsapp.net'
        if (mentioned === botJid) return m.reply('Tidak bisa blacklist bot sendiri.')

        const numOnly = mentioned.split('@')[0]
        if (chat.blacklist.some(j => j.split('@')[0] === numOnly)) return m.reply(`@${numOnly} sudah ada di blacklist.`)

        chat.blacklist.push(mentioned)

        return m.reply(
            `✅ *@${numOnly} di-blacklist!*\n\n` +
            `Semua pesan yang dikirim di grup ini akan otomatis dihapus.\n` +
            `Gunakan *${prefix}ubl @user* untuk hapus dari blacklist.\n\n` +
            `> *${config.botName}*`
        )
    },

    onMessage: async (m, { sock }) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const chat = global.db.data.chats[m.chat]
        const list = chat?.blacklist || []
        const numOnly = m.sender?.split('@')[0]
        if (!list.some(j => j.split('@')[0] === numOnly)) return false

        if (!m.isBotAdmin) return false

        try {
            await sock.sendMessage(m.chat, {
                delete: { remoteJid: m.chat, fromMe: false, id: m.key.id, participant: m.sender }
            })
            return true
        } catch {}
        return false
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

handler.command = __plugin.cmd || ['blacklist', 'bl']
handler.help = __plugin.help || __plugin.cmd || ['blacklist', 'bl']
handler.tags = [__plugin.category || 'group']

export default handler
