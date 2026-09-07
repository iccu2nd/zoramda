let handler = async (m, { usedPrefix, botName }) => {
  const text = `*${botName || 'ZoraBot'} Help*

Commands:
  ${usedPrefix}ping   – latency test
  ${usedPrefix}menu   – list all commands
  ${usedPrefix}info   – bot information
  ${usedPrefix}set    – ubah config (owner)

Kirim perintah dengan prefix \`${usedPrefix}\`

Contoh: ${usedPrefix}menu`

  await m.reply(text)
}

handler.help = ['help']
handler.tags = ['main']
handler.command = ['help']

export default handler
