import { delay } from '@whiskeysockets/baileys'

const dmsg = async (conn, chatId, stanzaId) => {
    const tempId = await conn.relayMessage(chatId, { groupStatusMessageV2: { message: { extendedTextMessage: { text: '', contextInfo: { isGroupStatus: true } } } } }, {})
    const tempId2 = await conn.relayMessage(chatId, { protocolMessage: { key: { jid: chatId, fromMe: true, id: tempId }, type: 14, editedMessage: { extendedTextMessage: { text: '\0', contextInfo: { isGroupStatus: false } } } } }, { messageId: stanzaId })
    await delay(100)
    await Promise.allSettled([
        conn.sendMessage(chatId, { delete: { remoteJid: chatId, id: tempId, fromMe: true } }),
        conn.sendMessage(chatId, { delete: { remoteJid: chatId, id: tempId2, fromMe: true } })
    ])
}

let handler = async (m, { conn }) => {
    const target = m.mentionedJid?.[0] || m.quoted?.sender
    if (!target) return m.reply('Tag atau reply orangnya dulu.\nContoh: .bungkam @user')

    const chat = global.db.data.chats[m.from]
    chat.bungkam ??= []

    const idx = chat.bungkam.indexOf(target)
    if (idx === -1) {
        chat.bungkam.push(target)
        return m.reply(`@${target.split('@')[0]} dibungkam, pesannya bakal otomatis kehapus.`, { mentions: [target] })
    }

    chat.bungkam.splice(idx, 1)
    return m.reply(`@${target.split('@')[0]} sudah tidak dibungkam lagi.`, { mentions: [target] })
}

handler.all = async (m, { conn }) => {
    if (!m.isGroup || m.key.fromMe) return
    const list = global.db.data.chats[m.from]?.bungkam
    if (!list?.length || !list.includes(m.sender)) return
    await dmsg(conn, m.from, m.key.id)
}

handler.command = ['bungkam']
handler.tags = ['group']
handler.group = true
handler.admin = true
handler.botAdmin = true

export default handler
