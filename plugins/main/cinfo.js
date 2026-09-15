const __plugin =  {
    cmd: ['cinfo', 'ci', 'cekidch'],
    category: 'info',
    run: async (m, { sock, text, prefix, cmd }) => {
        let inviteCode = null
        let newsletterJid = null

        if (text) {
            const linkMatch = text.match(/whatsapp\.com\/channel\/([\w]+)/i)
            if (linkMatch) {
                inviteCode = linkMatch[1]
            } else if (text.endsWith('@newsletter')) {
                newsletterJid = text.trim()
            } else {
                return m.reply(
                    'Format tidak valid.\n\n' +
                    'Gunakan:\n' +
                    `• *${prefix}${cmd} https://whatsapp.com/channel/xxxx*\n` +
                    `• *${prefix}${cmd} 120363xxxxx@newsletter*`
                )
            }
        } else if (m.isNewsletter) {
            newsletterJid = m.chat
        } else if (m.quoted) {
            const quotedText = m.quoted[m.quoted.type]?.text || m.quoted[m.quoted.type]?.caption || ''
            const quotedLinkMatch = quotedText.match(/whatsapp\.com\/channel\/([\w]+)/i)
            if (quotedLinkMatch) {
                inviteCode = quotedLinkMatch[1]
            } else {
                return m.reply('Pesan yang di-reply tidak mengandung link saluran.')
            }
        } else {
            return m.reply(`Kirim link atau JID saluran.\n\nContoh: *${prefix}${cmd} https://whatsapp.com/channel/xxxx*`)
        }

        await m.react('⏳')

        try {
            const meta = inviteCode
                ? await sock.newsletterMetadata('invite', inviteCode)
                : await sock.newsletterMetadata('jid', newsletterJid)

            if (!meta) throw new Error('Metadata kosong')

            const tm = meta.thread_metadata
            const jid = meta.id
            const name = tm.name?.text || '-'
            const desc = tm.description?.text || '-'
            const subscribers = Number(tm.subscribers_count || 0).toLocaleString('id-ID')
            const state = meta.state?.type === 'ACTIVE' ? 'Aktif' : (meta.state?.type || '-')
            const verified = tm.verification === 'VERIFIED' ? 'Terverifikasi' : 'Tidak Terverifikasi'
            const invite = tm.invite ? `https://whatsapp.com/channel/${tm.invite}` : null
            const picPath = tm.picture?.direct_path || tm.preview?.direct_path || null

            const body =
                `━━「 *INFO SALURAN* 」━━\n\n` +
                `*Nama* : ${name}\n` +
                `*JID* : ${jid}\n` +
                `*Subscriber* : ${subscribers}\n` +
                `*Status* : ${state}\n` +
                `*Verifikasi* : ${verified}\n` +
                `*Link* : ${invite || '-'}\n\n` +
                `*Deskripsi*\n${desc}`

            const buttons = [
                { type: 'copy', label: 'Copy JID', code: jid }
            ]

            if (invite) {
                buttons.push({ type: 'url', label: 'Buka Saluran', url: invite })
            }

            await sock.sendInteractiveButton(m.chat, {
                body,
                footer: jid,
                image: picPath ? `https://mmg.whatsapp.net${picPath}` : undefined,
                buttons
            }, { quoted: m })

            await m.react('✅')
        } catch (e) {
            await m.react('❌')
            m.reply(`Gagal ambil metadata saluran.\n\n_${e.message}_`)
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
    sock, conn, text, args, prefix, usedPrefix, command, cmd: command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin,
  })
}

handler.command = __plugin.cmd || ['cinfo', 'ci', 'cekidch']
handler.help = __plugin.help || __plugin.cmd || ['cinfo', 'ci', 'cekidch']
handler.tags = [__plugin.category || 'info']

export default handler
