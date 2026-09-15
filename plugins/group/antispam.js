const spamTracker = new Map()

const getUser = (jid) => {
    if (!global.db.data.users[jid]) global.db.data.users[jid] = {}
    if (!global.db.data.users[jid].spamWarn) global.db.data.users[jid].spamWarn = 0
    return global.db.data.users[jid]
}

const SPAM_WINDOW = 60 * 1000
const MAX_SPAM_WARN = 3

const __plugin =  {
    cmd: ['antispam'],
    category: 'group',
    run: async (m, { text }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!m.isAdmin && !m.isOwner) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const chat = global.db.data.chats[m.chat]
        const args = text.trim().split(/ +/)
        const action = args[0]?.toLowerCase()

        if (action === 'on') {
            const limit = parseInt(args[1])
            chat.antiSpam = true
            if (limit && limit > 0) chat.antiSpamLimit = limit
            return m.reply(`✅ Anti-Spam diaktifkan.\nBatas: ${chat.antiSpamLimit || 8} pesan / menit.\n3x kena warn spam = auto kick.`)
        } else if (action === 'off') {
            chat.antiSpam = false
            return m.reply('Anti-Spam dinonaktifkan di grup ini.')
        } else {
            const status = chat.antiSpam ? 'ON' : 'OFF'
            let help = `*Anti-Spam*\n\n`
            help += `Status: *[ ${status} ]*\n`
            help += `Batas: ${chat.antiSpamLimit || 8} pesan / menit\n\n`
            help += `- .antispam on\n`
            help += `- .antispam on <batas>\n`
            help += `- .antispam off`
            return m.reply(help)
        }
    },

    onMessage: async (m, { sock }) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const chat = global.db.data.chats[m.chat]
        if (!chat?.antiSpam) return false
        if (m.isAdmin || m.isOwner) return false

        const limit = chat.antiSpamLimit || 8
        const key = `${m.chat}:${m.sender}`
        const now = Date.now()

        let timestamps = spamTracker.get(key) || []
        timestamps = timestamps.filter(t => now - t < SPAM_WINDOW)
        timestamps.push(now)
        spamTracker.set(key, timestamps)

        if (timestamps.length <= limit) return false

        spamTracker.set(key, [])

        try {
            const user = getUser(m.sender)
            user.spamWarn += 1

            if (user.spamWarn >= MAX_SPAM_WARN) {
                user.spamWarn = 0
                if (!m.isBotAdmin) {
                    await m.reply(`@${m.sender.split('@')[0]} kedetek spam dan kena limit warn, tapi bot bukan admin. Kick manual ya.`, { mentions: [m.sender] })
                    return true
                }
                await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove')
                await sock.sendMessage(m.chat, { text: `@${m.sender.split('@')[0]} terdeteksi spam dan sudah mencapai limit warn (${MAX_SPAM_WARN}/${MAX_SPAM_WARN}), otomatis dikeluarkan.`, mentions: [m.sender] })
            } else {
                await sock.sendMessage(m.chat, { text: `@${m.sender.split('@')[0]} terdeteksi spam (>${limit} pesan/menit). Warn (${user.spamWarn}/${MAX_SPAM_WARN}).`, mentions: [m.sender] })
            }
            return true
        } catch (e) {
            console.error('Gagal memproses anti-spam:', e.message)
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

handler.command = __plugin.cmd || ['antispam']
handler.help = __plugin.help || __plugin.cmd || ['antispam']
handler.tags = [__plugin.category || 'group']

export default handler
