/**
 * Owner-only bot/session stats.
 * Usage: .stats
 */

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const mi = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d}h`)
  if (h) parts.push(`${h}j`)
  parts.push(`${mi}m`)
  return parts.join(' ')
}

let handler = async (m, { conn, isOwner, config, sessionId, botName }) => {
  if (!isOwner) return m.reply('Perintah ini hanya untuk owner.')

  let groupCount = '?'
  try {
    const groups = await conn.groupFetchAllParticipating()
    groupCount = Object.keys(groups || {}).length
  } catch {
    // non-fatal, just show '?'
  }

  const cfg = config.getAll()
  const mem = process.memoryUsage()

  const text = [
    `*📊 ${botName} Stats*`,
    '',
    `Session ID: ${sessionId.slice(0, 8)}...`,
    `Nomor bot: ${conn.user?.id?.split(':')[0] || '-'}`,
    `Grup diikuti: ${groupCount}`,
    `User di-ban: ${(cfg.bannedUsers || []).length}`,
    '',
    `Mode publik: ${cfg.publicMode ? 'ON' : 'OFF'}`,
    `Maintenance: ${cfg.maintenanceMode ? 'ON' : 'OFF'}`,
    `Anti-spam: ${cfg.antiSpam ? 'ON' : 'OFF'}`,
    '',
    `Bot uptime: ${formatUptime(process.uptime())}`,
    `Memory: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
  ].join('\n')

  await m.reply(text)
}

handler.help = ['stats']
handler.tags = ['admin']
handler.command = ['stats']
handler.permission = 'admin'

export default handler
