function isAnimatedWebp(buffer) {
    return buffer.includes('ANIM') || buffer.includes('ANMF')
}

const __plugin =  {
    cmd: ['toimg', 'toimage', 'stickertoimg'],
    category: 'tools',
    run: async (m, { sock, prefix, cmd }) => {
        const target = m.quoted || m
        const buffer = await m.download().catch(() => null)

        if (!buffer || !/webp/.test(buffer.mimetype) || target.type !== 'stickerMessage') {
            return m.reply(`⌗ *Stiker ke Gambar*\n\nReply stiker (yang diam/bukan animasi) dengan caption *${prefix}${cmd}*.\n\nKalau stikernya bergerak, pakai *${prefix}tovideo*.`)
        }

        if (isAnimatedWebp(buffer)) {
            await m.react('❌')
            return m.reply(`❌ Itu stiker bergerak (animasi), bukan stiker diam.\n\nUntuk stiker bergerak, pakai *${prefix}tovideo* ya, bukan *${prefix}toimg*.`)
        }

        await m.react('⏳')

        try {
            const sharp = (await import('sharp')).default
            const result = await sharp(buffer)
                .png({ quality: 100, compressionLevel: 9 })
                .toBuffer()

            if (!result || !result.length) throw new Error('Hasil gambar kosong.')

            await sock.sendImage(m.chat, result, '✅ Berhasil diubah jadi gambar!', m)
            await m.react('✅')
        } catch (e) {
            console.error('toimg Error:', e)
            await m.react('❌')
            m.reply('❌ Gagal mengubah stiker jadi gambar.')
            throw e
        }
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
    sock, conn, text, args, prefix, usedPrefix, command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin, cmd: command,
  })
}

handler.command = __plugin.cmd || ['toimg', 'toimage', 'stickertoimg']
handler.help = __plugin.help || __plugin.cmd || ['toimg', 'toimage', 'stickertoimg']
handler.tags = [__plugin.category || 'tools']

export default handler
