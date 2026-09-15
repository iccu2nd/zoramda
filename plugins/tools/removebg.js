import axios from 'axios'
import FormData from 'form-data'

const __plugin =  {
    cmd: ['removebg', 'nobg', 'removebackground', 'rbg'],
    category: 'tools',
    run: async (m, { sock, config, prefix }) => {
        const buffer = await m.download().catch(() => null)
        if (!buffer || !/image/.test(buffer.mimetype)) {
            return m.reply(
                `⌗ *Remove Background*\n\n` +
                `Hapus latar belakang gambar secara otomatis.\n\n` +
                `› *${prefix}removebg* (reply gambar)\n\n` +
                `> *${config.botName}*`
            )
        }

        await m.react('⏳')

        try {
            const result = await removeBg(buffer)
            await sock.sendImage(m.chat, Buffer.from(result), '✅ Latar belakang berhasil dihapus!', m)
            await m.react('✅')
        } catch (e) {
            console.error('RemoveBG Error:', e)
            await m.react('❌')
            m.reply(`❌ Gagal: ${e.message}`)
            throw e
        }
    }
}

async function removeBg(imageBuffer) {
    const api = axios.create({ baseURL: 'https://api4g.iloveimg.com' })

    const { data: html } = await axios.get('https://www.iloveimg.com/id/hapus-latar-belakang')
    const bearerToken = html.match(/ey[a-zA-Z0-9?%-_/]+/g)[1]
    api.defaults.headers.post['authorization'] = `Bearer ${bearerToken}`
    const taskId = html.match(/taskId = '(\w+)/)[1]

    const formUpload = new FormData()
    formUpload.append('file', imageBuffer, `${Math.random().toString(36).slice(2)}.jpg`)
    formUpload.append('task', taskId)

    const { data: uploadData, status: uploadStatus } = await api.post('/v1/upload', formUpload, {
        headers: formUpload.getHeaders()
    })
    if (uploadStatus !== 200) throw new Error('Upload gagal')

    const formRemoveBg = new FormData()
    formRemoveBg.append('task', taskId)
    formRemoveBg.append('server_filename', uploadData.server_filename)

    const { data: removeBgData, headers, status: removeBgStatus } = await api.post('/v1/removebackground', formRemoveBg, {
        headers: formRemoveBg.getHeaders(),
        responseType: 'arraybuffer'
    })
    if (removeBgStatus !== 200 || !/image/.test(headers['content-type'])) {
        throw new Error('Proses hapus latar belakang gagal')
    }

    return removeBgData
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
    sock, conn, text, args, prefix, usedPrefix, command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin, cmd: command,
  })
}

handler.command = __plugin.cmd || ['removebg', 'nobg', 'removebackground', 'rbg']
handler.help = __plugin.help || __plugin.cmd || ['removebg', 'nobg', 'removebackground', 'rbg']
handler.tags = [__plugin.category || 'tools']

export default handler
