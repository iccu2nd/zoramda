import { PassThrough } from 'stream'
import { Readable } from 'stream'
import ffmpeg from 'fluent-ffmpeg'

const toMp3 = (input) => {
    return new Promise((resolve, reject) => {
        const output = new PassThrough()
        const buffers = []
        const source = Buffer.isBuffer(input) ? Readable.from(input) : input

        ffmpeg(source)
            .audioCodec('libmp3lame')
            .audioFrequency(44100)
            .audioBitrate(192)
            .toFormat('mp3')
            .addOutputOptions(['-map_metadata -1'])
            .on('error', (err) => reject(err))
            .pipe(output)

        output.on('data', (chunk) => buffers.push(chunk))
        output.on('end', () => resolve(Buffer.concat(buffers)))
    })
}

const __plugin =  {
    cmd: ['toaudio'],
    category: 'tools',
    run: async (m, { sock }) => {
        if (!m.quoted) return m.reply('Reply ke pesan video atau audio terlebih dahulu.')

        const buffer = await m.download().catch(() => null)
        if (!buffer || !/audio|video/.test(buffer.mimetype)) {
            return m.reply('Hanya bisa digunakan pada pesan video atau audio.')
        }

        await m.react('⏳')

        try {
            const mp3 = await toMp3(buffer)
            await sock.sendMessage(m.chat, {
                audio: mp3,
                ptt: false,
                mimetype: 'audio/mpeg'
            }, { quoted: m })

            await m.react('✅')
        } catch (e) {
            console.error(e)
            await m.react('❌')
            m.reply('Gagal mengkonversi media.')
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
    sock, conn, text, args, prefix, usedPrefix, command, config,
    isOwner, isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin, cmd: command,
  })
}

handler.command = __plugin.cmd || ['toaudio']
handler.help = __plugin.help || __plugin.cmd || ['toaudio']
handler.tags = [__plugin.category || 'tools']

export default handler
