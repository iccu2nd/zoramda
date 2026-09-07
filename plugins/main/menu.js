import { applyTemplate } from '../../src/utils/helpers.js'

let handler = async (m, { usedPrefix, plugins, botConfig, botName, responses }) => {
  const byTag = plugins.getMenuByTags()
  const title = botConfig?.menuTitle || `${botName || 'Botenv'} Menu`
  let text = `*${title}*\n\n`

  for (const [tag, helps] of Object.entries(byTag)) {
    text += `*${tag.toUpperCase()}*\n`
    const unique = [...new Set(helps)]
    for (const h of unique) {
      text += `  ${usedPrefix}${h}\n`
    }
    text += '\n'
  }

  text += applyTemplate(responses.menuFooter, { prefix: usedPrefix, botName: botName || 'Botenv' })
  await m.reply(text)
}

handler.help = ['menu']
handler.tags = ['main']
handler.command = ['menu']
handler.responses = {
  menuFooter: '_Prefix: {prefix}_\n_{botName}_',
}

export default handler
