const __plugin =  {
    cmd: ['uptime'],
    category: 'info',
    run: async (m, { config }) => {
        const seconds = process.uptime()

        const d = Math.floor(seconds / 86400)
        const h = Math.floor((seconds % 86400) / 3600)
        const mnt = Math.floor((seconds % 3600) / 60)
        const s = Math.floor(seconds % 60)

        const parts = []
        if (d) parts.push(`${d}d`)
        if (h) parts.push(`${h}j`)
        if (mnt) parts.push(`${mnt}m`)
        parts.push(`${s}d`.replace('d', 's'))

        await m.reply(`Bot Active!\n${parts.join(' ')}`)
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

handler.command = __plugin.cmd || ['uptime']
handler.help = __plugin.help || __plugin.cmd || ['uptime']
handler.tags = [__plugin.category || 'info']

export default handler
