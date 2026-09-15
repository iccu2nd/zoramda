const __plugin =  {
    cmd: ['antilottie'],
    category: 'group',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const chat = global.db.data.chats[m.chat]
        const action = text.toLowerCase().trim()

        if (action === 'on') {
            chat.antilottie = true
            return m.reply('Anti-Lottie Sticker berhasil diaktifkan di grup ini!')
        } else if (action === 'off') {
            chat.antilottie = false
            return m.reply('Anti-Lottie Sticker dinonaktifkan di grup ini.')
        } else {
            const status = chat.antilottie ? 'ON' : 'OFF'
            return m.reply(`Status Anti-Lottie di grup ini: *[ ${status} ]*\n\nGunakan \`!antilottie on\` untuk menyalakan atau \`!antilottie off\` untuk mematikan.`)
        }
    },

    onMessage: async (m, { sock }) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const chat = global.db.data.chats[m.chat]
        if (!chat?.antilottie) return false

        if (m.type === 'lottieStickerMessage' || m.message?.lottieStickerMessage) {
            if (!m.isBotAdmin) return false
            try {
                await sock.sendMessage(m.chat, {
                    delete: { remoteJid: m.chat, fromMe: m.key.fromMe, id: m.key.id, participant: m.sender }
                })
                return true
            } catch (e) {
                console.error('Gagal menghapus Lottie sticker:', e.message)
            }
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

handler.command = __plugin.cmd || ['antilottie']
handler.help = __plugin.help || __plugin.cmd || ['antilottie']
handler.tags = [__plugin.category || 'group']

export default handler
