let handler = async (m, { responses }) => {
  await m.reply(responses.helpText)
}

handler.help = ['help']
handler.tags = ['main']
handler.command = ['help']
handler.responses = {
  helpText:
    '*{botName} Help*\n\n' +
    'Commands:\n' +
    '  {prefix}ping   – latency test\n' +
    '  {prefix}menu   – list all commands\n' +
    '  {prefix}info   – bot information\n' +
    '  {prefix}set    – ubah config (owner)\n\n' +
    'Kirim perintah dengan prefix `{prefix}`\n\n' +
    'Contoh: {prefix}menu',
}

export default handler
