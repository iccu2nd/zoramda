let handler = async (m) => {
  const start = Date.now()
  await m.reply('Pong!')
  // Optional second line with latency (still very fast)
  // const ms = Date.now() - start
  // await m.reply(`Latency ≈ ${ms}ms`)
}

handler.help = ['ping']
handler.tags = ['main']
handler.command = ['ping']

export default handler
