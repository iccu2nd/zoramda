let handler = async (m, { sessionId, botConfig, botName }) => {
  const uptime = process.uptime()
  const h = Math.floor(uptime / 3600)
  const min = Math.floor((uptime % 3600) / 60)
  const s = Math.floor(uptime % 60)

  const text = `*${botName || 'ZoraBot'} Info*

• Nama    : ${botName || 'ZoraBot'}
• Owner   : ${botConfig?.ownerName || 'Owner'}
• Prefix  : ${botConfig?.prefix || '.'}
• Mode    : ${botConfig?.publicMode ? 'Public' : 'Self'}
• Runtime : Node.js ${process.version}
• Uptime  : ${h}h ${min}m ${s}s
• Session : ${sessionId?.slice(0, 8) || '-'}
• Status  : ${botConfig?.maintenanceMode ? 'Maintenance' : 'Online'}`

  await m.reply(text)
}

handler.help = ['info']
handler.tags = ['main']
handler.command = ['info']

export default handler
