let handler = async (m, { responses }) => {
  await m.reply(responses.pong)
}

handler.help = ['ping']
handler.tags = ['main']
handler.command = ['ping']
handler.responses = {
  pong: 'Pong! 🏓',
}

export default handler
