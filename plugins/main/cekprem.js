const __plugin =  {
    cmd: ['cekprem', 'checkprem', 'myprem'],
    category: 'main',
    description: 'Cek status premium Anda atau user lain',
    run: async (m, { config, text }) => {
        const rawTarget = m.mentionedJid?.[0] || m.quoted?.sender
        const jid = rawTarget || m.sender
        const user = global.db.data.users[jid]

        if (!user) return m.reply(rawTarget ? 'Orang itu belum tercatat di database.' : 'Data Anda belum tercatat, coba kirim pesan apa saja dulu.')

        const isSelf = jid === m.sender
        const isPremium = !!(user.premium && user.premiumTime > Date.now())

        let caption = `💎 *CEK PREMIUM*\n\n`
        caption += `- *User:* @${jid.split('@')[0]}\n`
        caption += `- *Status:* ${isPremium ? '✅ Premium Aktif' : '❌ Bukan Premium'}\n`

        if (isPremium) {
            const expire = new Date(user.premiumTime).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
            const daysLeft = Math.ceil((user.premiumTime - Date.now()) / 86400000)
            caption += `- *Berlaku hingga:* ${expire}\n`
            caption += `- *Sisa waktu:* ${daysLeft} hari lagi\n`
        } else if (isSelf) {
            caption += `\nBelum jadi member premium. Hubungi owner bot buat upgrade ke premium biar dapat limit lebih banyak & fitur eksklusif!`
        }
        return m.reply(caption, { mentions: [jid] })
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

handler.command = __plugin.cmd || ['cekprem', 'checkprem', 'myprem']
handler.help = __plugin.help || __plugin.cmd || ['cekprem', 'checkprem', 'myprem']
handler.tags = [__plugin.category || 'main']

export default handler
