const __plugin =  {
    cmd: ['addprem'],
    category: 'owner',
    run: async (m, { sock, text }) => {
        if (!m.isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')

        const target = m.mentionedJid?.[0] || m.quoted?.sender
        if (!target) return m.reply('Tag atau reply user.\nContoh: .addprem @user 7\natau reply pesan lalu: .addprem 7')

        const user = global.db.data.users[target]
        if (!user) return m.reply('User tidak ditemukan di database.')

        const days = parseInt(m.quoted ? text : text?.split(' ').pop())
        if (!days || days <= 0) return m.reply('Masukan jumlah hari.\nContoh: .addprem @user 7')

        const base = user.premium && user.premiumTime > Date.now() ? user.premiumTime : Date.now()
        user.premium = true
        user.premiumTime = base + days * 86400000

        const expire = new Date(user.premiumTime).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        return sock.sendMessage(m.chat, {
            text: `Berhasil menambah kan @${target.split('@')[0]} ke daftar premium selama ${days} hari (hingga ${expire})`,
            mentions: [target]
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

handler.command = __plugin.cmd || ['addprem']
handler.help = __plugin.help || __plugin.cmd || ['addprem']
handler.tags = [__plugin.category || 'owner']

export default handler
