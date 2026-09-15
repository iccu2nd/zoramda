import os from 'os'

const API_KEY = 'pilO34wM7E1IoMp0AP8xSzBm_ltGx8f8'
const URL_POST = 'https://pastebin.com/api/api_post.php'

const BNODE = [{
    tag: 'biz', attrs: {}, content: [{
        tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{
            tag: 'native_flow', attrs: { v: '9', name: 'mixed' }
        }]
    }]
}]

const __plugin =  {
    cmd: ['pasteup', 'paste'],
    category: 'tools',
    description: 'Upload teks ke Pastebin',

    run: async (m, { sock, config, text, prefix, cmd }) => {
        const pasteText = text || m.quoted?.text || m.quoted?.caption
        if (!pasteText) return m.reply(
            `Masukkan teks!\nContoh: *${prefix}${cmd} hello world*\natau reply pesan yang mau di-upload`
        )

        await m.react('☁️')

        try {
            const formData = `api_dev_key=${API_KEY}&api_option=paste&api_paste_code=${encodeURIComponent(pasteText.split(os.EOL).join('\n'))}`

            const res = await fetch(URL_POST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            })

            const result = await res.text()
            if (!result.startsWith('http')) {
                await m.react('❌')
                return m.reply(`❌ Gagal upload: ${result}`)
            }

            const pasteUrl = result.trim()
            const rawUrl = pasteUrl.replace('pastebin.com/', 'pastebin.com/raw/')
            const lineCount = pasteText.split('\n').length
            const charCount = pasteText.length
            const sizeKB = (charCount / 1024).toFixed(2)

            const buttons = [
                { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'pastebin', copy_code: pasteUrl }) },
                { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'raw', copy_code: rawUrl }) },
            ]

            await sock.relayMessage(m.chat, {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                        interactiveMessage: {
                            contextInfo: {
                                stanzaId: m.key.id,
                                participant: m.key.participant || m.key.remoteJid,
                                quotedMessage: m.message,
                                remoteJid: m.chat
                            },
                            body: {
                                text:
                                    `Upload berhasil!\n\n` +
                                    `⟡ Lines ╌ ${lineCount}\n` +
                                    `⟡ Chars ╌ ${charCount}\n` +
                                    `⟡ Size ╌ ${sizeKB} KB`
                            },
                            footer: { text: 'tap to copy url' },
                            nativeFlowMessage: {
                                buttons,
                                messageParamsJson: JSON.stringify({
                                    bottom_sheet: {
                                        in_thread_buttons_limit: 1,
                                        list_title: 'hasil upload',
                                        button_title: 'lihat semua link'
                                    }
                                })
                            }
                        }
                    }
                }
            }, { additionalNodes: BNODE })

            await m.react('✅')
        } catch (e) {
            console.error(e)
            await m.react('❌')
            m.reply(`❌ Error: ${e.message}`)
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
  if (typeof __plugin.run !== 'function') throw new Error('Plugin run missing')
  return __plugin.run(m, {
    sock, conn, text, args, prefix, usedPrefix, command, cmd: command, config,
    isOwner: ctx.isOwner, isPremium: ctx.isPremium, isAdmin: ctx.isAdmin, isBotAdmin: ctx.isBotAdmin,
  })
}
handler.command = __plugin.cmd || ['paste']
handler.help = __plugin.help || __plugin.cmd || ['paste']
handler.tags = [__plugin.category || 'tools']
handler.heavy = true
export default handler
