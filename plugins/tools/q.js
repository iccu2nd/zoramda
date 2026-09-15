import util from 'util'

const __plugin =  {
    cmd: ['q', 'quoted'],
    category: 'tools',
    run: async (m) => {
        let target = m.quoted ? m.quoted : m
        let content = util.inspect(target, { depth: 5, showHidden: false })
        m.reply(content)
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
    sock, conn, text, args, prefix, usedPrefix, command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin, cmd: command,
  })
}

handler.command = __plugin.cmd || ['q', 'quoted']
handler.help = __plugin.help || __plugin.cmd || ['q', 'quoted']
handler.tags = [__plugin.category || 'tools']

export default handler
