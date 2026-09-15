const __plugin =  {
    cmd: ['bc', 'broadcast'],
    category: 'owner',
    run: async (m, { sock, text }) => {
        if (!m.isOwner) return m.reply('Hanya owner bot yang dapat menggunakan perintah ini.')
        if (!text) return m.reply('Masukan teks yang ingin di broadcast.\nContoh: .bc Halo semua!')

        const groupIds = Object.keys(global.db.data.chats).filter(jid => jid.endsWith('@g.us'))
        if (!groupIds.length) return m.reply('Belum ada grup yang tercatat.')

        await m.reply(`📢 Memulai broadcast ke ${groupIds.length} grup...`)

        let success = 0
        let failed = 0

        for (const jid of groupIds) {
            try {
                await sock.sendMessage(jid, { text: `📢 Broadcast\n\n${text}` })
                success++
            } catch {
                failed++
            }
            await new Promise(resolve => setTimeout(resolve, 1500))
        }

        return m.reply(`✅ Broadcast selesai.\n\n› Berhasil: ${success}\n› Gagal: ${failed}\n› Total grup: ${groupIds.length}`)
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

handler.command = __plugin.cmd || ['bc', 'broadcast']
handler.help = __plugin.help || __plugin.cmd || ['bc', 'broadcast']
handler.tags = [__plugin.category || 'owner']

export default handler
