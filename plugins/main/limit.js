/**
 * Lets any user check their own remaining limit.
 * Only meaningful when the owner has turned "use limit" on in settings —
 * see src/core/ConfigService.js (useLimit, defaultLimit, premiumDefaultLimit).
 */
let handler = async (m, { config, isOwner, isPremium, botConfig }) => {
  if (!botConfig.useLimit) {
    return m.reply('Sistem limit sedang tidak aktif.')
  }
  if (isOwner) {
    return m.reply('Owner tidak terkena limit.')
  }
  if (isPremium && botConfig.premiumUnlimited) {
    return m.reply('✨ Kamu premium — limit kamu unlimited.')
  }

  const remaining = config.getUserLimit(m.sender)
  const label = isPremium ? 'Limit premium' : 'Limit'
  await m.reply(`${label} kamu tersisa: *${remaining}*`)
}

handler.help = ['limit']
handler.tags = ['main']
handler.command = ['limit', 'ceklimit']

export default handler
