/**
 * Dedicated admin command list — separate from the regular .menu so owners
 * and group admins can find management commands quickly.
 */
let handler = async (m, { usedPrefix, botName, isOwner }) => {
  const p = usedPrefix

  const sections = [
    {
      title: '👤 USER MANAGEMENT (owner)',
      lines: [`${p}ban @user / reply`, `${p}unban @user / reply`, `${p}banlist`],
    },
    {
      title: '📢 BROADCAST & INFO (owner)',
      lines: [`${p}broadcast <pesan>`, `${p}stats`],
    },
    {
      title: '👥 GROUP MEMBERS (admin grup)',
      lines: [`${p}kick @user / reply`, `${p}promote @user / reply`, `${p}demote @user / reply`],
    },
    {
      title: '📣 TAG (admin grup)',
      lines: [`${p}tagall [pesan]`, `${p}hidetag [pesan]`],
    },
    {
      title: '⚙️ GROUP SETTINGS (admin grup)',
      lines: [`${p}group open`, `${p}group close`, `${p}group name <teks>`, `${p}group desc <teks>`],
    },
    {
      title: '🗑️ MODERASI',
      lines: [`${p}delete (reply pesan)`],
    },
    {
      title: '🔧 BOT CONFIG (owner)',
      lines: [`${p}set <key> <value>`],
    },
  ]

  let text = `*🛡️ ${botName} Admin Menu*\n\n`
  for (const s of sections) {
    text += `*${s.title}*\n`
    for (const l of s.lines) text += `  ${l}\n`
    text += '\n'
  }
  text += isOwner
    ? '_Kamu login sebagai owner — semua command di atas bisa dipakai._'
    : '_Command "admin grup" bisa dipakai kalau kamu admin di grup ini. Command "(owner)" cuma bisa dipakai owner bot._'

  await m.reply(text)
}

handler.help = ['adminmenu']
handler.tags = ['admin']
handler.command = ['adminmenu', 'menuadmin']
handler.permission = 'admin'

export default handler
