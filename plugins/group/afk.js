const formatDuration = (ms) => {
    const detik = Math.floor(ms / 1000)
    const mnt = Math.floor(detik / 60)
    const jam = Math.floor(mnt / 60)
    const sisaDetik = detik % 60
    const sisaMnt = mnt % 60

    let durStr = ''
    if (jam > 0) durStr += `${jam} jam `
    if (mnt > 0) durStr += `${sisaMnt} menit `
    if (detik > 0 || durStr === '') durStr += `${sisaDetik} detik`
    return durStr
}

const __plugin =  {
    cmd: ['afk'],
    category: 'group',
    description: 'Tandai dirimu sedang AFK',

    run: async (m, { text }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya bisa digunakan di grup.')

        const user = global.db.data.users[m.sender]
        user.afk = Date.now()
        user.afkReason = text?.trim() || ''
        user.afkName = m.pushName || m.sender.split('@')[0]

        m.reply(`${m.pushName || m.sender.split('@')[0]} sekarang AFK${text ? ': ' + text : ''}`)
    },

    onMessage: async (m) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const sender = global.db.data.users[m.sender] || {}
        if (sender.afk > -1) {
            const durStr = formatDuration(Date.now() - sender.afk)
            const nama = sender.afkName || m.pushName || m.sender.split('@')[0]
            const alasan = sender.afkReason

            sender.afk = -1
            sender.afkReason = ''
            sender.afkName = ''

            const cmd = m.body?.replace(/^[./#!]/, '').trim().split(/ +/)[0].toLowerCase()
            if (cmd !== 'afk') {
                await m.reply(`${nama} berhenti AFK${alasan ? ' setelah ' + alasan : ''}\nSelama ${durStr}`).catch(() => {})
            }
        }

        const targets = [...new Set([
            ...(m.mentionedJid || []),
            ...(m.quoted?.sender ? [m.quoted.sender] : [])
        ])]

        for (const jid of targets) {
            const target = global.db.data.users[jid]
            if (!target || target.afk < 0) continue

            const durStr = formatDuration(Date.now() - target.afk)
            const nama = target.afkName || jid.split('@')[0]

            await m.reply(`${m.pushName || m.sender.split('@')[0]} Jangan tag dia!\nDia sedang AFK ${target.afkReason ? 'dengan alasan ' + target.afkReason : 'tanpa alasan'}\nSelama ${durStr}`).catch(() => {})
        }

        return false
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

handler.command = __plugin.cmd || ['afk']
handler.help = __plugin.help || __plugin.cmd || ['afk']
handler.tags = [__plugin.category || 'group']

export default handler
