const getUser = (jid) => {
    if (!global.db.data.users[jid]) global.db.data.users[jid] = { warn: 0 }
    if (!global.db.data.users[jid].warn) global.db.data.users[jid].warn = 0
    return global.db.data.users[jid]
}

const __plugin =  {
    cmd: ['cekwarn'],
    category: 'group',
    run: async (m) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')

        const chat = global.db.data.chats[m.chat]
        const maxWarn = chat.maxWarn || 3

        const jid = m.mentionedJid?.[0] || m.quoted?.sender || m.sender
        const warn = getUser(jid).warn
        return m.reply(`⚠️ @${jid.split('@')[0]} punya ${warn}/${maxWarn} warn.`, { mentions: [jid] })
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

handler.command = __plugin.cmd || ['cekwarn']
handler.help = __plugin.help || __plugin.cmd || ['cekwarn']
handler.tags = [__plugin.category || 'group']

export default handler
