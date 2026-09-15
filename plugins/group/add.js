import axios from 'axios'
import { jidNormalizedUser, generateWAMessageFromContent, proto, getBinaryNodeChild } from '@whiskeysockets/baileys'
import { reportPluginError } from '../handler.js'

const __plugin =  {
    cmd: ['add'],
    category: 'group',
    run: async (m, { sock, text, isAdmin, isBotAdmin, config, prefix, cmd }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya bisa digunakan di dalam grup.')
        if (!isAdmin && !m.isOwner) return m.reply('Hanya admin grup yang bisa menggunakan perintah ini.')
        if (!isBotAdmin) return m.reply('Bot harus jadi admin untuk menambahkan member.')

        if (!text && !m.quoted) return m.reply(
            `*Add Member*\n\n` +
            `Gunakan perintah ini untuk menambahkan member ke grup.\n\n` +
            `› *${prefix}${cmd} 628xxxx*\n` +
            `› *${prefix}${cmd}* (reply pesan target)\n\n` +
            `> *${config.botName}*`
        )

        let numbers = []

        if (m.quoted && !text) {
            const raw = m.quoted.sender
            if (raw) numbers = [raw.endsWith('@s.whatsapp.net') ? raw : raw.split('@')[0] + '@s.whatsapp.net']
        } else {
            numbers = text
                .split(/[\s,]+/)
                .map(n => n.replace(/[^0-9]/g, ''))
                .filter(n => n.length >= 7)
                .map(n => {
                    if (n.startsWith('0')) n = '62' + n.slice(1)
                    if (!n.startsWith('62') && !n.startsWith('1') && n.length <= 12) n = '62' + n
                    return n + '@s.whatsapp.net'
                })
        }

        numbers = [...new Set(numbers)]

        if (!numbers.length) return m.reply(`Nomor tidak valid.\nContoh: *${prefix}${cmd} 6281234567890*`)

        const metadata = await sock.groupMetadata(m.chat).catch(() => null)
        if (!metadata) return m.reply('Gagal mendapatkan informasi grup.')

        const groupName = metadata.subject
        const existingParticipants = metadata.participants.map(p => jidNormalizedUser(p.id))

        const link = await sock.groupInviteCode(m.chat).catch(() => null)

        for (const target of numbers) {
            const jid = jidNormalizedUser(target)
            const num = jid.split('@')[0]

            if (existingParticipants.includes(jid)) {
                await m.reply(`@${num} sudah menjadi anggota grup ini.`, { mentions: [jid] })
                continue
            }

            try {
                const result = await sock.groupParticipantsUpdate(m.chat, [jid], 'add')
                const { status, content } = result?.[0] || {}

                if (status === '200' || status === 200) {
                    await m.reply(`Berhasil menambahkan @${num} ke grup.`, { mentions: [jid] })
                    continue
                }

                if (status === '409') {
                    await m.reply(`@${num} sudah ada di dalam grup.`, { mentions: [jid] })
                    continue
                }

                if (status === '404') {
                    await m.reply(`@${num} tidak terdaftar di WhatsApp.`, { mentions: [jid] })
                    continue
                }

                if (status === '421') {
                    await m.reply(`Tidak dapat menambahkan @${num}. Mereka telah membatasi undangan ke grup.`, { mentions: [jid] })
                    continue
                }

                if (status === '408') {
                    if (!link) {
                        await m.reply(`@${num} baru saja keluar dari grup dan link undangan gagal diambil.`, { mentions: [jid] })
                        continue
                    }

                    await m.reply(`@${num} baru saja keluar dari grup. Link undangan dikirim ke chat pribadinya.`, { mentions: [jid] })

                    await sock.sendMessage(jid, {
                        text: `Anda diundang kembali ke grup "${groupName}":\nhttps://chat.whatsapp.com/${link}`,
                    })
                    continue
                }

                if (status === '403') {
                    const addRequest = getBinaryNodeChild(content, 'add_request')

                    if (!addRequest?.attrs?.code) {
                        await m.reply(`@${num} tidak bisa ditambahkan. Privasi kontak mencegah penambahan ke grup.`, { mentions: [jid] })
                        continue
                    }

                    await m.reply(`Mengirim undangan ke @${num}.`, { mentions: [jid] })

                    const { code, expiration } = addRequest.attrs
                    const pp = await sock.profilePictureUrl(m.chat, 'image').catch(() => null)
                    let jpegThumbnail = Buffer.alloc(0)
                    if (Buffer.isBuffer(pp)) {
                        jpegThumbnail = pp
                    } else if (typeof pp === 'string' && pp.startsWith('http')) {
                        jpegThumbnail = await axios.get(pp, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)).catch(() => Buffer.alloc(0))
                    }

                    const msg = generateWAMessageFromContent(
                        jid,
                        proto.Message.fromObject({
                            groupInviteMessage: {
                                groupJid: m.chat,
                                inviteCode: code,
                                inviteExpiration: parseInt(expiration),
                                groupName,
                                jpegThumbnail,
                                caption: 'Undangan untuk bergabung ke grup WhatsApp saya',
                            },
                        }),
                        { userJid: sock.user.id }
                    )

                    await sock.sendMessage(jid, { forward: msg, mentions: [jid] })
                    continue
                }

                await m.reply(`Gagal menambahkan @${num}. Status: ${status}`, { mentions: [jid] })
            } catch (e) {
                console.error(e)
                await m.reply(`Error menambahkan @${num}: ${e?.message || 'Unknown error'}`, { mentions: [jid] })
                reportPluginError({ sock, config, m, cmd, prefix, text, e })
            }
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

handler.command = __plugin.cmd || ['add']
handler.help = __plugin.help || __plugin.cmd || ['add']
handler.tags = [__plugin.category || 'group']

export default handler
