const __plugin =  {
    cmd: ['listgc', 'listgroup'],
    category: 'owner',
    run: async (m, { sock, isOwner }) => {
        if (!isOwner) return m.reply('Fitur ini khusus untuk owner.')

        const groups = await sock.groupFetchAllParticipating()
        const list = Object.values(groups)

        if (!list.length) return m.reply('Bot tidak ada di grup manapun.')

        const buttons = list.map(g => ({
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: `${g.subject} (${g.participants.length} member)`,
                copy_code: g.id
            })
        }))

        const messageParamsJson = JSON.stringify({
            bottom_sheet: {
                in_thread_buttons_limit: 1,
                list_title: 'daftar grup',
                button_title: 'lihat semua grup'
            }
        })

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
                            text: `Bot bergabung di *${list.length}* grup.\n\nTekan nama grup untuk copy ID-nya.`
                        },
                        footer: { text: 'tap to copy group id' },
                        nativeFlowMessage: { buttons, messageParamsJson }
                    }
                }
            }
        }, {
            additionalNodes: [{
                tag: 'biz', attrs: {}, content: [{
                    tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{
                        tag: 'native_flow', attrs: { v: '9', name: 'mixed' }
                    }]
                }]
            }]
        })
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

handler.command = __plugin.cmd || ['listgc', 'listgroup']
handler.help = __plugin.help || __plugin.cmd || ['listgc', 'listgroup']
handler.tags = [__plugin.category || 'owner']

export default handler
