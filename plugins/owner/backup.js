import { createRequire } from 'module'
import fs from 'fs/promises'
import path from 'path'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

const ignoredDirs = ['node_modules', 'session', '.git', '.replit', '.cache']
const ignoredFiles = ['package-lock.json', 'db.json']

async function addFilesToZip(zip, dir, currentPath = '') {
    const list = await fs.readdir(dir)
    for (const file of list) {
        const fullPath = path.join(dir, file)
        const zipPath = currentPath ? path.join(currentPath, file) : file
        const stat = await fs.stat(fullPath)

        if (stat.isDirectory()) {
            if (!ignoredDirs.includes(file)) await addFilesToZip(zip, fullPath, zipPath)
        } else {
            const ext = path.extname(file).toLowerCase()
            if (!ignoredFiles.includes(file) && ext !== '.zip' && ext !== '.gz') {
                zip.addLocalFile(fullPath, currentPath)
            }
        }
    }
}

const __plugin =  {
    cmd: ['backup'],
    category: 'owner',
    run: async (m, { sock, isOwner }) => {
        if (!isOwner) return m.reply("Fitur ini khusus untuk owner.")

        m.reply("Sedang membuat backup script, mohon tunggu...")

        const dateStr = new Date().toISOString().slice(0, 10)
        const zipName = `${dateStr}.zip`

        try {
            const zip = new AdmZip()
            await addFilesToZip(zip, '.')
            await zip.writeZipPromise(zipName)

            await sock.sendMessage(m.chat, {
                document: await fs.readFile(zipName),
                mimetype: 'application/zip',
                fileName: zipName
            }, { quoted: m })
        } catch (e) {
            m.reply(`Gagal membuat backup: ${e.message}`)
            throw e
        } finally {
            fs.unlink(zipName).catch(() => {})
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

handler.command = __plugin.cmd || ['backup']
handler.help = __plugin.help || __plugin.cmd || ['backup']
handler.tags = [__plugin.category || 'owner']

export default handler
