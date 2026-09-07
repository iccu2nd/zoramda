import { applyTemplate } from '../../src/utils/helpers.js'

let handler = async (m, { sessionId, botConfig, responses }) => {
  const uptime = process.uptime()
  const h = Math.floor(uptime / 3600)
  const min = Math.floor((uptime % 3600) / 60)
  const s = Math.floor(uptime % 60)

  const text = applyTemplate(responses.infoText, {
    mode: botConfig?.publicMode ? 'Public' : 'Self',
    nodeVersion: process.version,
    uptime: `${h}h ${min}m ${s}s`,
    sessionId: sessionId?.slice(0, 8) || '-',
    status: botConfig?.maintenanceMode ? 'Maintenance' : 'Online',
  })

  await m.reply(text)
}

handler.help = ['info']
handler.tags = ['main']
handler.command = ['info']
handler.responses = {
  infoText:
    '*{botName} Info*\n\n' +
    '• Nama    : {botName}\n' +
    '• Owner   : {ownerName}\n' +
    '• Prefix  : {prefix}\n' +
    '• Mode    : {mode}\n' +
    '• Runtime : Node.js {nodeVersion}\n' +
    '• Uptime  : {uptime}\n' +
    '• Session : {sessionId}\n' +
    '• Status  : {status}',
}

export default handler
