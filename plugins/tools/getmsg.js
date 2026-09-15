const __plugin =  {
    onMessage: async (m, { sock }) => {
        if (!m.body || m.isNewsletter) return false

        const msgs = global.db.data.msgs
        if (!msgs || !(m.body in msgs)) return false

        const entry = msgs[m.body]

        await sock.sendMessage(m.chat, {
            forward: {
                key: {
                    remoteJid: m.chat,
                    id: entry.quotedId || m.id,
                    fromMe: false,
                    participant: entry.sender
                },
                message: entry.message
            },
            force: true
        }, { quoted: m }).catch(() => {})

        return true
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

handler.command = __plugin.cmd || ['unknown']
handler.help = __plugin.help || __plugin.cmd || ['unknown']
handler.tags = [__plugin.category || 'tools']

export default handler
