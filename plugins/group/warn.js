const getUser = (jid) => {
    if (!global.db.data.users[jid]) global.db.data.users[jid] = { warn: 0 }
    if (!global.db.data.users[jid].warn) global.db.data.users[jid].warn = 0
    return global.db.data.users[jid]
}

const __plugin =  {
    cmd: ['warn'],
    category: 'group',
    run: async (m, { sock, text, cmd, isAdmin }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const chat = global.db.data.chats[m.chat]
        const maxWarn = chat.maxWarn || 3

        const jid = m.mentionedJid?.[0] || m.quoted?.sender
        if (!jid) return m.reply(`Tag atau reply orangnya dulu.\nContoh: .${cmd} @user`)

        const user = getUser(jid)
        user.warn += 1

        if (user.warn >= maxWarn) {
            user.warn = 0
            if (!m.isBotAdmin) return m.reply(`⚠️ @${jid.split('@')[0]} kena limit warn tapi bot bukan admin, kick manual ya.`, { mentions: [jid] })
            await sock.groupParticipantsUpdate(m.chat, [jid], 'remove')
            return m.reply(`⚠️ @${jid.split('@')[0]} kena limit warn (${maxWarn}/${maxWarn}), otomatis dikeluarkan.`, { mentions: [jid] })
        }

        return m.reply(`⚠️ @${jid.split('@')[0]} mendapat warn (${user.warn}/${maxWarn})${text ? `\nAlasan: ${text}` : ''}`, { mentions: [jid] })
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

handler.command = __plugin.cmd || ['warn']
handler.help = __plugin.help || __plugin.cmd || ['warn']
handler.tags = [__plugin.category || 'group']

export default handler
