/**
 * Owner-only user ban management.
 * Banned users are silently ignored by MessageHandler on every command —
 * see src/core/MessageHandler.js.
 *
 * Usage:
 *   .ban @user            (mention)
 *   .ban 628123456789     (raw number)
 *   .ban                  (reply to their message, no args needed)
 *   .unban 628123456789
 *   .banlist
 */
import { resolveTargets } from '../../src/utils/helpers.js'

let handler = async (m, { args, isOwner, config, command, usedPrefix }) => {
  if (!isOwner) return m.reply('Perintah ini hanya untuk owner.')

  if (command === 'banlist') {
    const list = config.getBannedUsers()
    if (list.length === 0) return m.reply('Belum ada user yang di-ban.')
    const text = list.map((jid, i) => `${i + 1}. ${jid.split('@')[0]}`).join('\n')
    return m.reply(`*Daftar user di-ban* (${list.length})\n\n${text}`)
  }

  const targets = resolveTargets(m, args)
  if (targets.length === 0) {
    return m.reply(
      `Target tidak ditemukan.\nCara pakai:\n${usedPrefix}${command} @user\n${usedPrefix}${command} 628xxxxxxxxxx\natau reply pesan orangnya dengan ${usedPrefix}${command}`
    )
  }

  const results = []
  for (const jid of targets) {
    if (command === 'ban') {
      await config.ban(jid)
      results.push(`🚫 ${jid.split('@')[0]}`)
    } else {
      await config.unban(jid)
      results.push(`✅ ${jid.split('@')[0]}`)
    }
  }

  const verb = command === 'ban' ? 'Di-ban' : 'Di-unban'
  await m.reply(`*${verb}:*\n${results.join('\n')}`)
}

handler.help = ['ban <@user|nomor>', 'unban <@user|nomor>', 'banlist']
handler.tags = ['admin']
handler.command = ['ban', 'unban', 'banlist']

export default handler
