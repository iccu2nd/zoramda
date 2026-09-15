import axios from 'axios'

const API = 'https://copier.saveweb2zip.com'

async function cloneweb(link) {
    const { data } = await axios.post(`${API}/api/copySite`, {
        url: link,
        renameAssets: false,
        saveStructure: false,
        alternativeAlgorithm: false,
        mobileVersion: false
    }, {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
            'Referer': 'https://saveweb2zip.com/en'
        },
        timeout: 15000
    })

    const md5 = data.md5
    if (!md5) throw new Error('Gagal mendapatkan MD5 hash')

    for (let i = 0; i < 10; i++) {
        const { data: status } = await axios.get(`${API}/api/getStatus/${md5}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                'Referer': 'https://saveweb2zip.com/en'
            }
        })

        if (status.isFinished) {
            const res = await axios.get(`${API}/api/downloadArchive/${md5}`, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                    'Referer': 'https://saveweb2zip.com/en'
                }
            })
            return {
                fileName: `${md5}.zip`,
                buffer: Buffer.from(res.data),
                link: `${API}/api/downloadArchive/${md5}`
            }
        }

        await new Promise(r => setTimeout(r, 60000))
    }

    throw new Error('Timeout: Proses cloning terlalu lama')
}

const __plugin =  {
    cmd: ['cloneweb', 'cw'],
    category: 'tools',
    run: async (m, { sock, text }) => {
        if (!text) return m.reply('Masukkan URL website yang ingin di-clone.\nContoh: .cloneweb https://example.com')

        const url = text.trim()
        if (!url.startsWith('http')) return m.reply('URL harus diawali http:// atau https://')

        await m.reply('Proses cloning website dimulai...\n\nIni bisa memakan waktu beberapa menit. Sabar ya.')

        try {
            const result = await cloneweb(url)

            await sock.sendMessage(m.chat, {
                document: result.buffer,
                fileName: result.fileName,
                mimetype: 'application/zip',
                caption: `Clone Website Berhasil\n\nURL: ${url}\nDownload: ${result.link}`
            }, { quoted: m })

        } catch (e) {
            m.reply(`Gagal clone website: ${e.message}`)
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

handler.command = __plugin.cmd || ['cloneweb', 'cw']
handler.help = __plugin.help || __plugin.cmd || ['cloneweb', 'cw']
handler.tags = [__plugin.category || 'tools']

export default handler
