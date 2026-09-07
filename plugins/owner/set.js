/**
 * Owner command to quickly change config from WhatsApp
 * Usage:
 *   .set botName NamaBotBaru
 *   .set prefix !
 *   .set publicMode true
 *   .set ownerNumbers 628xxx,628yyy
 */
let handler = async (m, { text, args, isOwner, config, usedPrefix }) => {
  if (!isOwner) {
    return m.reply(config.get('ownerOnlyMessage') || 'Owner only.')
  }

  if (!args[0]) {
    const cfg = config.getAll()
    const list = [
      `botName: ${cfg.botName}`,
      `ownerName: ${cfg.ownerName}`,
      `prefix: ${cfg.prefix}`,
      `publicMode: ${cfg.publicMode}`,
      `maintenanceMode: ${cfg.maintenanceMode}`,
      `antiSpam: ${cfg.antiSpam}`,
      `menuTitle: ${cfg.menuTitle}`,
    ].join('\n')
    return m.reply(
      `*Current Config*\n\n${list}\n\nUbah:\n${usedPrefix}set <key> <value>\n\nContoh:\n${usedPrefix}set botName MyBot\n${usedPrefix}set prefix !`
    )
  }

  const key = args[0]
  const value = args.slice(1).join(' ')
  if (!value && value !== 'false' && value !== '0') {
    return m.reply(`Nilai kosong.\nContoh: ${usedPrefix}set botName ZoraBot`)
  }

  // Parse boolean / number
  let parsed = value
  if (value === 'true' || value === 'false') parsed = value === 'true'
  else if (!isNaN(value) && value.trim() !== '') parsed = Number(value)
  else if (key === 'ownerNumbers') {
    parsed = value.split(/[,;\s]+/).map((n) => n.replace(/\D/g, '')).filter(Boolean)
  }

  try {
    await config.update({ [key]: parsed })
    await m.reply(`✅ *${key}* diubah menjadi:\n${Array.isArray(parsed) ? parsed.join(', ') : parsed}`)
  } catch (err) {
    await m.reply(`Gagal update: ${err.message}`)
  }
}

handler.help = ['set']
handler.tags = ['owner']
handler.command = ['set', 'setting', 'config']
handler.permission = 'owner'

export default handler
