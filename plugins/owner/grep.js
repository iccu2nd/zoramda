import fs from 'fs'
import path from 'path'

const ROOT_DIR = path.join(process.cwd(), 'plugins')
const MAX_RESULTS = 50

function scan(folder, keyword, results) {
    for (const file of fs.readdirSync(folder)) {
        const full = path.join(folder, file)
        const stat = fs.statSync(full)

        if (stat.isDirectory()) {
            scan(full, keyword, results)
        } else if (file.endsWith('.js')) {
            const lines = fs.readFileSync(full, 'utf-8').split('\n')
            lines.forEach((line, i) => {
                if (line.includes(keyword)) results.push(`${path.relative(ROOT_DIR, full)} (baris ${i + 1})`)
            })
        }
    }
}

const __plugin =  {
    cmd: ['grepplugin', 'grep'],
    category: 'owner',
    run: async (m, { text, isOwner, prefix, cmd }) => {
        if (!isOwner) return m.reply('Fitur ini khusus untuk owner.')
        if (!text) return m.reply(`Masukin keyword.\nContoh: *${prefix + cmd} conn*`)

        await m.react('⏳')

        try {
            const results = []
            scan(ROOT_DIR, text, results)

            await m.react('✅')

            if (!results.length) return m.reply(`Tidak ditemukan keyword: *${text}*`)

            const shown = results.slice(0, MAX_RESULTS)
            let res = `*Hasil Grep Plugin*\nKeyword: ${text}\nDitemukan: ${results.length} baris\n\n`
            res += shown.map((v, i) => `${i + 1}. ${v}`).join('\n')
            if (results.length > MAX_RESULTS) res += `\n\n_...dan ${results.length - MAX_RESULTS} hasil lainnya, persempit keyword-nya._`

            return m.reply(res)
        } catch (e) {
            await m.react('❌')
            m.reply(`Gagal grep plugin: ${e.message}`)
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

handler.command = __plugin.cmd || ['grepplugin', 'grep']
handler.help = __plugin.help || __plugin.cmd || ['grepplugin', 'grep']
handler.tags = [__plugin.category || 'owner']

export default handler
