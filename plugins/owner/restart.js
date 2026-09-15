import { spawn } from 'child_process'

const __plugin =  {
    cmd: ['restart'],
    category: 'owner',
    run: async (m, { sock }) => {
        if (!m.isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')

        await m.reply('Merestart bot...')

        setTimeout(() => {
            const child = spawn(process.argv[0], process.argv.slice(1), {
                cwd: process.cwd(),
                detached: true,
                stdio: 'inherit'
            })
            child.unref()
            process.exit(0)
        }, 1000)
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

handler.command = __plugin.cmd || ['restart']
handler.help = __plugin.help || __plugin.cmd || ['restart']
handler.tags = [__plugin.category || 'owner']

export default handler
