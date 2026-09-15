const __plugin =  {
  cmd: ['base64', 'b64'],
  category: 'tools',
  description: 'Encode/decode Base64',
  run: async (m, { text }) => {
    if (!text) return m.reply('Usage: .base64 encode|decode <string>');
    const [mode, ...rest] = text.split(' ');
    const input = rest.join(' ');
    if (!input) return m.reply('Masukkan string.');
    try {
      const result = mode === 'encode' || mode === 'enc'
        ? Buffer.from(input, 'utf-8').toString('base64')
        : mode === 'decode' || mode === 'dec'
          ? Buffer.from(input, 'base64').toString('utf-8')
          : null;
      if (result === null) return m.reply('Mode harus encode atau decode');
      return m.reply(result);
    } catch {
      return m.reply('Error: input tidak valid');
    }
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

handler.command = __plugin.cmd || ['base64', 'b64']
handler.help = __plugin.help || __plugin.cmd || ['base64', 'b64']
handler.tags = [__plugin.category || 'tools']

export default handler
