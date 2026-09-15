import axios from 'axios'
import FormData from 'form-data'

const __plugin =  {
    cmd: ['web2apk', 'apkbuilder'],
    category: 'tools',
    run: async (m, { sock, config, prefix, text }) => {
        const buffer = await m.download().catch(() => null)
        if (!buffer || !/image/.test(buffer.mimetype || '')) {
            return m.reply(
                `⌗ *Web2Apk Builder*\n\n` +
                `Ubah website jadi APK Android.\n\n` +
                `› Reply sebuah gambar (buat jadi icon app) dengan caption:\n` +
                `*${prefix}web2apk <url>|<nama app>|<versi>*\n\n` +
                `Bagian versi opsional, default *1.0.0*.\n\n` +
                `Contoh:\n` +
                `${prefix}web2apk https://www.google.com|Google App\n` +
                `${prefix}web2apk https://www.google.com|Google App|2.1.0\n\n` +
                `> *${config.botName}*`
            )
        }

        const [url, appName, versionName = '1.0.0'] = (text || '').split('|').map(s => s?.trim())
        if (!url || !/^https?:\/\//i.test(url) || !appName) {
            return m.reply(`Format salah. Gunakan:\n*${prefix}web2apk <url>|<nama app>|<versi>* (reply gambar icon)`)
        }
        if (!/^\d+\.\d+\.\d+$/.test(versionName)) {
            return m.reply('Format versi harus angka.angka.angka, contoh: 1.0.0')
        }

        await m.react('⏳')

        try {
            const versionCode = versionName.split('.').reduce((acc, n) => acc * 100 + Number(n), 0)
            const packageName = `com.${appName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app'}.web2apk`
            const baseUrl = 'https://webappcreator.amethystlab.org'

            const form = new FormData()
            form.append('websiteUrl', url)
            form.append('appName', appName)
            form.append('icon', buffer, { filename: 'icon.png' })
            form.append('packageName', packageName)
            form.append('versionName', versionName)
            form.append('versionCode', versionCode)

            const { data } = await axios.post(`${baseUrl}/api/build-apk`, form, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Origin': baseUrl,
                    'Referer': `${baseUrl}/`,
                    ...form.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            })

            if (!data.success) throw new Error(data.message || 'Gagal mem-build APK dari server.')

            await sock.sendMessage(m.chat, {
                text: `✅ *APK Berhasil Dibuat!*\n\n` +
                    `› *Nama:* ${appName}\n` +
                    `› *Package:* ${packageName}\n` +
                    `› *Versi:* ${versionName}\n` +
                    `› *Link:* ${baseUrl}${data.downloadUrl}`
            }, { quoted: m })

            await m.react('✅')
        } catch (e) {
            console.error('Web2Apk Error:', e)
            await m.react('❌')
            m.reply(`❌ Gagal: ${e.message}`)
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

handler.command = __plugin.cmd || ['web2apk', 'apkbuilder']
handler.help = __plugin.help || __plugin.cmd || ['web2apk', 'apkbuilder']
handler.tags = [__plugin.category || 'tools']

export default handler
