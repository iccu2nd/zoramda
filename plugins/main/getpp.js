const __plugin =  {
    cmd: ['getpp'],
    category: 'main',
    run: async (m, { sock, text }) => {
        let jid = m.mentionedJid?.[0] || m.quoted?.sender

        if (!jid && text) {
            const number = text.replace(/\D/g, '')
            if (!number) return m.reply('Nomor tidak valid.\nContoh: .getpp 628123456789')

            let check
            try {
                check = await sock.onWhatsApp(number + '@s.whatsapp.net')
            } catch {
                check = []
            }
            if (!check?.[0]?.exists) return m.reply('Nomor tidak terdaftar di WhatsApp.')
            jid = check[0].jid
        }

        if (!jid) return m.reply('Tag, reply, atau kasih nomornya.\nContoh:\n.getpp @user')

        const pp = await sock.profilePictureUrl(jid, 'image').catch(() => null)
        if (!pp) return m.reply('Terjadi kesalahan saat mengambil foto profile\n\n> mungkin dia tidak punya foto profil atau privasinya dibatasi.')

        await sock.sendMessage(m.chat, {
            image: pp,
            caption: `@${jid.split('@')[0]}`,
            mentions: [jid]
        }, { quoted: m })
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

handler.command = __plugin.cmd || ['getpp']
handler.help = __plugin.help || __plugin.cmd || ['getpp']
handler.tags = [__plugin.category || 'main']

export default handler
