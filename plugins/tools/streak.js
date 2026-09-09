/**
 * Simple daily streak per sender, per session.
 * Toggle via Bot Settings → streakEnabled
 */
const memory = new Map() // key: sessionId:sender → { count, lastDay }

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10) // UTC day
}

function yesterdayKey() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return dayKey(d)
}

let handler = async (m, { sessionId, botConfig, usedPrefix, command }) => {
  if (botConfig?.streakEnabled === false) {
    return m.reply('Fitur streak sedang dimatikan di Bot Settings.')
  }

  const sender = m.senderPn || m.sender
  const key = `${sessionId}:${sender}`
  const today = dayKey()
  const prev = memory.get(key) || { count: 0, lastDay: null }

  if (prev.lastDay === today) {
    return m.reply(
      `🔥 *Streak kamu: ${prev.count} hari*\n\nSudah check-in hari ini. Kembali lagi besok!`
    )
  }

  let count = 1
  if (prev.lastDay === yesterdayKey()) {
    count = (prev.count || 0) + 1
  }

  memory.set(key, { count, lastDay: today })

  // soft bound
  if (memory.size > 50000) {
    const first = memory.keys().next().value
    if (first) memory.delete(first)
  }

  await m.reply(
    `🔥 *Streak +1!*\n\nStreak kamu sekarang: *${count} hari*\nJangan putus besok — ketik *${usedPrefix}${command}* lagi.`
  )
}

handler.help = ['streak']
handler.tags = ['tools']
handler.command = ['streak']
handler.permission = 'everyone'

export default handler
