const aliases = ['addmsg', 'addsticker', 'addstiker', 'addvn', 'addvideo', 'addaudio', 'addimg', 'addgif']

const __plugin =  {
    cmd: aliases,
    category: 'owner',
    description: 'Simpan pesan (teks/stiker/gambar/video/audio) yang dibalas dengan nama tertentu',

    run: async (m, { text, cmd }) => {
        if (!m.isOwner) return m.reply('Perintah ini hanya untuk owner bot.')

        if (!m.quoted) return m.reply(`Balas pesan yang mau disimpan dengan perintah *.${cmd} <nama>*`)

        const nama = text?.trim()
        if (!nama) return m.reply(`Penggunaan: .${cmd} <nama>\n\nContoh:\n.${cmd} halo`)

        const msgs = global.db.data.msgs ??= {}
        if (msgs[nama]) return m.reply(`Nama *${nama}* sudah terdaftar.\n\nHapus dulu pakai .delmsg ${nama} kalau mau ganti.`)

        const { type, id, sender, lid, ...content } = m.quoted

        msgs[nama] = {
            message: content,
            quotedId: id,
            sender,
            addedBy: m.sender,
            addedAt: Date.now()
        }

        return m.reply(`Berhasil menyimpan pesan dengan nama *${nama}*\n\n› Akses dengan mengetik "${nama}" langsung di chat.`)
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

handler.command = __plugin.cmd || ['unknown']
handler.help = __plugin.help || __plugin.cmd || ['unknown']
handler.tags = [__plugin.category || 'owner']

export default handler
