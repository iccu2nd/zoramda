const LINK_REGEX = /chat\.whatsapp\.com\/[a-zA-Z0-9]+|whatsapp\.com\/channel\/[a-zA-Z0-9]+/i

const __plugin =  {
    cmd: ['antilink'],
    category: 'group',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const chat = global.db.data.chats[m.chat]
        const action = text.toLowerCase().trim()

        if (action === 'on --kick') {
            chat.antiLink = true
            chat.antiLinkMode = 'kick'
            return m.reply('Anti-Link berhasil diaktifkan (mode: kick)!')
        } else if (action === 'on --delete' || action === 'on') {
            chat.antiLink = true
            chat.antiLinkMode = 'delete'
            return m.reply('Anti-Link berhasil diaktifkan (mode: delete)!')
        } else if (action === 'off') {
            chat.antiLink = false
            return m.reply('Anti-Link dinonaktifkan di grup ini.')
        } else {
            const status = chat.antiLink ? `ON (${chat.antiLinkMode || 'delete'})` : 'OFF'
            return m.reply(`Status Anti-Link di grup ini: *[ ${status} ]*\n\nGunakan\n\`.antilink on --delete\`\n\`.antilink on --kick\`\n\`.antilink off\`.`)
        }
    },

    onMessage: async (m, { sock }) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const chat = global.db.data.chats[m.chat]
        if (!chat?.antiLink) return false
        if (m.isAdmin) return false
        if (!LINK_REGEX.test(m.body || '')) return false
        if (!m.isBotAdmin) return false

        try {
            await sock.sendMessage(m.chat, {
                delete: { remoteJid: m.chat, fromMe: m.key.fromMe, id: m.key.id, participant: m.sender }
            })

            if (chat.antiLinkMode === 'kick') {
                await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove')
                await sock.sendMessage(m.chat, { text: `Link terdeteksi, @${m.sender.split('@')[0]} dikeluarkan.`, mentions: [m.sender] })
            } else {
                await sock.sendMessage(m.chat, { text: `Link terdeteksi dan dihapus dari @${m.sender.split('@')[0]}`, mentions: [m.sender] })
            }
            return true
        } catch (e) {
            console.error('Gagal memproses anti-link:', e.message)
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

handler.command = __plugin.cmd || ['antilink']
handler.help = __plugin.help || __plugin.cmd || ['antilink']
handler.tags = [__plugin.category || 'group']

export default handler
