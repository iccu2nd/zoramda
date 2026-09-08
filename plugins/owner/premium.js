/**
 * Owner-only premium member management.
 * Premium users get the 'premium' permission group, and (depending on the
 * premiumUnlimited / premiumDefaultLimit settings) a separate limit pool —
 * see src/core/ConfigService.js and src/core/MessageHandler.js.
 *
 * Usage:
 *   .addprem @user            (mention)
 *   .addprem 628123456789     (raw number)
 *   .addprem                  (reply to their message, no args needed)
 *   .delprem 628123456789
 *   .premlist
 *   .setlimit 628123456789 50   (owner override for a user's remaining limit)
 */
import { resolveTargets } from '../../src/utils/helpers.js'

let handler = async (m, { args, isOwner, config, command, usedPrefix }) => {
  if (!isOwner) return m.reply('Perintah ini hanya untuk owner.')

  if (command === 'premlist') {
    const list = config.getPremiumUsers()
    if (list.length === 0) return m.reply('Belum ada member premium.')
    const text = list
      .map((jid, i) => `${i + 1}. ${jid.split('@')[0]} — limit: ${config.getUserLimit(jid)}`)
      .join('\n')
    return m.reply(`*Daftar member premium* (${list.length})\n\n${text}`)
  }

  if (command === 'setlimit') {
    const [numberArg, amountArg] = args
    if (!numberArg || amountArg === undefined) {
      return m.reply(`Cara pakai:\n${usedPrefix}setlimit 628xxxxxxxxxx 50`)
    }
    const targets = resolveTargets(m, [numberArg])
    if (targets.length === 0) return m.reply('Target tidak ditemukan.')
    const value = await config.setUserLimit(targets[0], amountArg)
    return m.reply(`✅ Limit ${targets[0].split('@')[0]} diset ke ${value}.`)
  }

  const targets = resolveTargets(m, args)
  if (targets.length === 0) {
    return m.reply(
      `Target tidak ditemukan.\nCara pakai:\n${usedPrefix}${command} @user\n${usedPrefix}${command} 628xxxxxxxxxx\natau reply pesan orangnya dengan ${usedPrefix}${command}`
    )
  }

  const results = []
  for (const jid of targets) {
    if (command === 'addprem') {
      await config.addPremium(jid)
      results.push(`⭐ ${jid.split('@')[0]}`)
    } else {
      await config.removePremium(jid)
      results.push(`➖ ${jid.split('@')[0]}`)
    }
  }

  const verb = command === 'addprem' ? 'Ditambahkan sebagai premium' : 'Dihapus dari premium'
  await m.reply(`*${verb}:*\n${results.join('\n')}`)
}

handler.help = ['addprem <@user|nomor>', 'delprem <@user|nomor>', 'premlist', 'setlimit <nomor> <jumlah>']
handler.tags = ['owner']
handler.command = ['addprem', 'delprem', 'premlist', 'setlimit']
handler.permission = 'owner'

export default handler
