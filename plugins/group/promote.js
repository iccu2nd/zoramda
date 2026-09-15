import { jidNormalizedUser } from '@whiskeysockets/baileys'
import { reportPluginError } from '../handler.js'

const __plugin =  {
    cmd: ['promote'],
    category: 'group',
    run: async (m, { sock, text, isAdmin, isBotAdmin, config, prefix, cmd }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')
        if (!isBotAdmin) return m.reply('Bot harus menjadi admin untuk mempromosikan member.')

        const targets = m.mentionedJid?.length ? m.mentionedJid
            : m.quoted ? [m.quoted.sender]
            : text?.replace(/[^0-9]/g, '').length >= 10 ? [text.replace(/[^0-9]/g, '') + '@s.whatsapp.net']
            : []

        if (targets.length === 0) {
            let help = `⌗ *Promote System*\n\n`
            help += `Gunakan perintah ini untuk menjadikan member sebagai admin.\n\n`
            help += `› .promote @user\n`
            help += `› .promote 62831xxx\n`
            help += `› .promote (reply pesan target)\n\n`
            help += `> *${config.botName}*`
            return m.reply(help)
        }

        const botJid = jidNormalizedUser(sock.user.id)

        for (let target of targets) {
            let jid = jidNormalizedUser(target)

            if (jid === botJid) {
                m.reply('Aku sudah menjadi admin!')
                continue
            }

            try {
                await sock.groupParticipantsUpdate(m.chat, [jid], 'promote')
                await m.reply(`✅ Berhasil mempromosikan @${jid.split('@')[0]} sebagai Admin.`, { mentions: [jid] })
            } catch (e) {
                console.error(e)
                m.reply(`Gagal mempromosikan @${jid.split('@')[0]}.`)
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

handler.command = __plugin.cmd || ['promote']
handler.help = __plugin.help || __plugin.cmd || ['promote']
handler.tags = [__plugin.category || 'group']

export default handler
