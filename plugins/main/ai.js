import axios from 'axios'

async function deepai(prompt) {
    const chatHistory = JSON.stringify([{ role: 'user', content: prompt }])
    const payload = new URLSearchParams()
    payload.append('chat_style', 'chat')
    payload.append('chatHistory', chatHistory)

    const { data } = await axios.post('https://api.deepai.org/hacking_is_a_serious_crime', payload.toString(), {
        headers: {
            'api-key': 'tryit-84303483976-293520c15ccc5fada63d9e51c4639dbb',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
            Accept: '*/*',
            Origin: 'https://deepai.org',
            Referer: 'https://deepai.org/chat',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000
    })

    return data
}

const __plugin =  {
    cmd: ['ai'],
    category: 'main',
    run: async (m, { text }) => {
        if (!text) return m.reply('Mau nanya apa?\nContoh: .ai Apa itu logic?')

        try {
            const response = await deepai(text)
            if (!response) return m.reply('Gagal dapat jawaban, coba lagi.')

            await m.reply(response)
        } catch (e) {
            await m.reply('Gagal menghubungi AI, coba lagi nanti.')
            throw e
        }
    }
};

let handler = async (m, ctx) => {
  const sock = ctx.sock || ctx.conn
  const conn = ctx.conn || sock
  const text = ctx.text || m.body || ''
  const args = ctx.args || m.args || []
  const prefix = ctx.prefix || ctx.usedPrefix || m.usedPrefix || '.'
  const usedPrefix = prefix
  const command = ctx.command || m.command
  const config = ctx.config || {}
  const isOwner = ctx.isOwner
  const isPremium = ctx.isPremium
  if (typeof __plugin.run !== 'function') throw new Error('Plugin run missing')
  return __plugin.run(m, {
    sock, conn, text, args, prefix, usedPrefix, command, cmd: command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin,
  })
}

handler.command = __plugin.cmd || ['ai']
handler.help = __plugin.help || __plugin.cmd || ['ai']
handler.tags = [__plugin.category || 'main']

export default handler
