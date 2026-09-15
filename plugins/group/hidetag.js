const __plugin =  {
    cmd: ['hidetag', 'h'],
    category: 'group',
    run: async (m, { sock, text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const metadata = await sock.groupMetadata(m.chat)
        const participants = metadata.participants.map(p => p.id)

        const fakeQuoted = {
            key: {
                participant: '0@s.whatsapp.net',
                remoteJid: 'status@broadcast',
                fromMe: false,
                id: 'Halo'
            },
            message: {
                contactMessage: {
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Sy;Bot;;;\nFN:y\nitem1.TEL;waid=${m.sender.split('@')[0]}:${m.sender.split('@')[0]}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
                }
            }
        }

        await sock.sendMessage(m.chat, { text: text || '', mentions: participants }, { quoted: fakeQuoted })
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

handler.command = __plugin.cmd || ['hidetag', 'h']
handler.help = __plugin.help || __plugin.cmd || ['hidetag', 'h']
handler.tags = [__plugin.category || 'group']

export default handler
