let handler = async (m, { usedPrefix, plugins, botConfig, botName }) => {
  const byTag = plugins.getMenuByTags()
  const title = botConfig?.menuTitle || `${botName || 'ZoraBot'} Menu`
  let text = `*${title}*\n\n`

  for (const [tag, helps] of Object.entries(byTag)) {
    text += `*${tag.toUpperCase()}*\n`
    const unique = [...new Set(helps)]
    for (const h of unique) {
      text += `  ${usedPrefix}${h}\n`
    }
    text += '\n'
  }

  text += `_Prefix: ${usedPrefix}_\n`
  text += `_${botName || 'ZoraBot'}_`
  await m.reply(text)
}

handler.help = ['menu']
handler.tags = ['main']
handler.command = ['menu']

export default handler
