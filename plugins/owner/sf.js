import fs from 'fs'
import path from 'path'

const __plugin =  {
  cmd: ['sf'],
  category: 'owner',
  run: async (m, { text, isOwner }) => {
    if (!isOwner) return m.reply('Owner only.')
    const base = path.resolve('./plugins')

    if (!text) return m.reply('Usage: .sf name code | reply code')
    let n, c
    if (m.quoted) {
      n = text.trim()
      const q = m.quoted
      c = q.conversation || q.extendedTextMessage?.text
      if (q.type === 'documentMessage') {
        const buffer = await m.download()
        c = buffer.toString('utf-8')
      }
      if (!c) return m.reply('Reply text or file.')
    } else {
      const i = text.search(/\s/)
      if (i === -1) return m.reply('Format: .sf name.js code')
      n = text.slice(0, i).trim()
      c = text.slice(i).trim()
    }
    if (!n.endsWith('.js')) n += '.js'
    if (!c) return m.reply('Code empty.')
    const p = path.join(base, n)
    if (!p.startsWith(base)) return m.reply('Access denied.')
    const e = fs.existsSync(p)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, c)
    return m.reply(`${e ? 'Updated' : 'Saved'}: ${n}`)
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

handler.command = __plugin.cmd || ['sf']
handler.help = __plugin.help || __plugin.cmd || ['sf']
handler.tags = [__plugin.category || 'owner']

export default handler
