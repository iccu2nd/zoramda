const __plugin =  {
    cmd: ['delmsg'],
    category: 'owner',
    description: 'Hapus pesan tersimpan berdasarkan nama',

    run: async (m, { text }) => {
        if (!m.isOwner) return m.reply('Perintah ini hanya untuk owner bot.')

        const nama = text?.trim()
        if (!nama) return m.reply('Penggunaan: .delmsg <nama>\n\nContoh:\n.delmsg halo')

        const msgs = global.db.data.msgs
        if (!msgs?.[nama]) return m.reply(`Nama *${nama}* tidak terdaftar.`)

        delete msgs[nama]
        return m.reply(`Berhasil menghapus pesan dengan nama *${nama}*`)
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

handler.command = __plugin.cmd || ['delmsg']
handler.help = __plugin.help || __plugin.cmd || ['delmsg']
handler.tags = [__plugin.category || 'owner']

export default handler
