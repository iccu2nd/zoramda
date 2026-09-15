import { delay } from '@whiskeysockets/baileys'

const MAX_COUNT = 50

let handler = async (m, { conn, text, isAdmin, isOwner }) => {
  if (!m.isGroup) return m.reply('Hanya untuk grup.')
  if (!isAdmin && !isOwner) return m.reply('Hanya admin grup.')

  const target = m.mentionedJid?.[0] || m.quoted?.sender
  if (!target) return m.reply('Tag atau reply orangnya dulu.\nContoh: .spamtag @user 10')

  const args = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  let count = parseInt(args.find((a) => /^\d+$/.test(a)), 10)
  if (!count || count < 1) count = 5
  if (count > MAX_COUNT) count = MAX_COUNT

  await m.reply(`Mengirim ${count} tag…`)
  for (let i = 0; i < count; i++) {
    await conn.sendMessage(m.chat, {
      text: `@${String(target).split('@')[0]}`,
      mentions: [target],
    })
    await delay(800)
  }
}

handler.command = ['spamtag']
handler.help = ['spamtag @user [jumlah]']
handler.tags = ['group']
handler.permission = ['group', 'admin']
handler.heavy = true

export default handler
