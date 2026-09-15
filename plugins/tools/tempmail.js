import https from "https"

const POLL_INTERVAL_MS = (Number(process.env.TEMPMAIL_POLL_SECONDS) || 20) * 1000
const GENMAIL_BASE = "https://generator.email"
const URL_REGEX = /https?:\/\/[^\s"'<>)\]]+/g
const ANCHOR_REGEX = /<a\s[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis

function randomUser(len = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    let out = ""
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
    return out
}

function decodeEntities(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}

function stripTags(html) {
    return html.replace(/<[^>]+>/g, ' ').trim()
}

function htmlToText(html) {
    return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim()
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '...(dipotong)' : str
}

function extractLinks(html) {
    if (!html) return []
    const matches = html.match(URL_REGEX) || []
    const cleaned = matches.map(u => decodeEntities(u).replace(/[.,;]+$/, ''))
    return [...new Set(cleaned)]
}

function extractAnchors(html) {
    if (!html) return []
    const anchors = []
    ANCHOR_REGEX.lastIndex = 0
    let match
    while ((match = ANCHOR_REGEX.exec(html)) !== null) {
        const href = decodeEntities(match[1]).replace(/[.,;]+$/, '')
        const label = htmlToText(match[2])
        if (/^https?:\/\//i.test(href)) anchors.push({ href, label })
    }
    return anchors
}

function findMaskedLinks(html) {
    return extractAnchors(html).filter(a => a.label && a.label !== a.href)
}

function linkPreviewBlock(html, max = 3) {
    const links = extractLinks(html)
    if (!links.length) return ''
    const shown = links.slice(0, max)
    const more = links.length > shown.length ? `\n...+${links.length - shown.length} link lain` : ''
    return `\n\n*Link terdeteksi:*\n${shown.map(l => `\`\`\`${l}\`\`\``).join('\n')}${more}`
}

function cookieMapToStr(map) {
    return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

function cookieMapToObj(map) {
    return Object.fromEntries(map.entries())
}

function cookieObjToMap(obj) {
    return new Map(Object.entries(obj || {}))
}

function updateCookies(map, headers) {
    const raw = headers['set-cookie'] || []
    for (const c of raw) {
        const pair = c.split(';')[0]
        const idx = pair.indexOf('=')
        if (idx > 0) map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
}

function getMetaToken(html) {
    return (
        html.match(/name=["']api-token["'] content=["']([^"']+)["']/)?.[1] ||
        html.match(/content=["']([^"']+)["'] name=["']api-token["']/)?.[1] ||
        ''
    )
}

function getDomainsFromSelect(html) {
    const selectMatch =
        html.match(/<select[^>]*id=["']domain["'][^>]*>([\s\S]*?)<\/select>/i) ||
        html.match(/<select[^>]*name=["']domain["'][^>]*>([\s\S]*?)<\/select>/i)
    if (!selectMatch) return []

    const optionRe = /<option[^>]*value=["']([^"']+)["'][^>]*>/g
    const domains = []
    let match
    while ((match = optionRe.exec(selectMatch[1])) !== null) {
        if (match[1] && !domains.includes(match[1])) domains.push(match[1])
    }
    return domains
}

function parseInboxHtml(html) {
    const numMess = parseInt((html.match(/num_mess\s*:\s*(\d+)/) || [])[1] || '0')
    if (numMess === 0) return null

    const headMatch =
        html.match(/id="mail-summary-head"[^>]*>([\s\S]*?)<\/div>\s*<ins/) ||
        html.match(/id="mail-summary-head"[^>]*>([\s\S]*?)<\/div>\s*<div id="mail-summary-body"/)
    const headHtml = headMatch ? headMatch[1] : ''

    const from = (headHtml.match(/class="[^"]*from_div_45g45gg[^"]*">([^<]+)/) || [])[1]?.trim() || ''
    const subject = (html.match(/class="[^"]*subj-h1[^"]*">([^<]*)/) || [])[1]?.trim() || '(tanpa subjek)'
    const time = (headHtml.match(/class="[^"]*time_div_45g45gg[^"]*">([^<]+)/) || [])[1]?.trim() || ''
    const to = (html.match(/<span>To:\s*<\/span><span class="[^"]*wbreak">([^<]+)<\/span>/) || [])[1]?.trim() || ''
    const mid = (html.match(/data-mid=["']([^"']+)["']/) || [])[1] || ''

    const bodyMatch = html.match(/class="[^"]*mess_bodiyy[^"]*">([\s\S]*?)<ins class="[^"]*adsbygoogle/)
    const bodyHtml = bodyMatch ? bodyMatch[1] : ''

    return { from, to, subject, time, mid, bodyHtml, bodyText: htmlToText(bodyHtml), numMess }
}

class GeneratorEmailClient {
    constructor(base = GENMAIL_BASE) {
        this.base = base
    }

    request(url, opts = {}) {
        return new Promise((resolve, reject) => {
            const target = new URL(url)
            const options = {
                hostname: target.hostname,
                path: target.pathname + target.search,
                method: opts.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
                    'Accept-Language': 'en-US,en;q=0.9',
                    ...(opts.headers || {}),
                },
            }
            const req = https.request(options, (res) => {
                if ([301, 302].includes(res.statusCode)) {
                    const location = res.headers.location
                    return resolve(this.request(location.startsWith('http') ? location : this.base + location, opts))
                }
                let data = ''
                res.on('data', (chunk) => (data += chunk))
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
            })
            req.on('error', reject)
            if (opts.body) req.write(opts.body)
            req.end()
        })
    }

    async initSession(cookieMap = new Map()) {
        const resp = await this.request(`${this.base}/inbox3/`, {
            headers: { Cookie: cookieMapToStr(cookieMap) },
        })
        updateCookies(cookieMap, resp.headers)
        return { cookieMap, metaToken: getMetaToken(resp.body), html: resp.body }
    }

    async fetchDomains(cookieMap, metaToken, fallbackHtml = '') {
        const resp = await this.request(`${this.base}/api/domains.php`, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                Referer: `${this.base}/inbox3/`,
                Cookie: cookieMapToStr(cookieMap),
                'X-API-Token': metaToken,
            },
        })
        updateCookies(cookieMap, resp.headers)

        try {
            const parsed = JSON.parse(resp.body)
            const domains = parsed.map((d) => (typeof d === 'string' ? d : d.display || d.ascii)).filter(Boolean)
            if (domains.length) return domains
        } catch {}

        return getDomainsFromSelect(fallbackHtml)
    }

    async selectEmail(cookieMap, domain, user) {
        cookieMap.set('inbox_n', '1')
        cookieMap.set('inbox_ctx', `${domain}%2F${user}%2F`)

        const resp = await this.request(`${this.base}/inbox3/`, {
            headers: { Cookie: cookieMapToStr(cookieMap), Referer: `${this.base}/inbox3/` },
        })
        updateCookies(cookieMap, resp.headers)
        return { cookieMap, metaToken: getMetaToken(resp.body) }
    }

    async checkInbox(cookieMap, metaToken) {
        const resp = await this.request(`${this.base}/inbox3/`, {
            headers: { Cookie: cookieMapToStr(cookieMap), Referer: `${this.base}/inbox3/`, 'X-API-Token': metaToken },
        })
        updateCookies(cookieMap, resp.headers)
        return parseInboxHtml(resp.body)
    }
}

const client = new GeneratorEmailClient()

const TempMailStore = {
    all() {
        return global.db.data.tempmail ??= {}
    },
    get(sender) {
        return this.all()[sender] || null
    },
    save(sender, entry) {
        this.all()[sender] = entry
        return entry
    },
}

function btnIds(prefix, cmd) {
    return {
        menu: `${prefix}${cmd} menu`,
        create: `${prefix}${cmd} create`,
        confirmCreate: `${prefix}${cmd} confirmcreate`,
        check: `${prefix}${cmd} check`,
        refresh: `${prefix}${cmd} refresh`,
        raw: `${prefix}${cmd} raw`,
    }
}

async function sendButtons(sock, jid, text, buttons, opts = {}, title = 'TempMail') {
    try {
        const sent = await sock.sendInteractiveButton(
            jid,
            {
                title,
                body: text,
                footer: 'TempMail',
                buttons: buttons.map(b =>
                    b.type === 'copy'
                        ? { type: 'copy', label: b.label, code: b.code }
                        : { type: 'reply', label: b.label, id: b.id }
                ),
            },
            opts
        )
        if (!sent?.key?.id) throw new Error('Pengiriman button tidak menghasilkan message id')
        return sent
    } catch {
        const manual = buttons
            .map(b => (b.type === 'copy' ? `${b.label}: ${b.code}` : `${b.label}: ketik "${b.id}"`))
            .join('\n')
        return sock.sendMessage(jid, { text: `${text}\n\n${manual}` }, opts)
    }
}

function sendCreateOnlyButton(sock, jid, text, ctx, opts = {}) {
    const ids = btnIds(ctx.prefix, ctx.cmd)
    return sendButtons(sock, jid, text, [{ type: 'reply', label: 'Buat Email', id: ids.create }], opts)
}

function sendMainMenu(sock, jid, text, ctx, entry, opts = {}) {
    const ids = btnIds(ctx.prefix, ctx.cmd)
    return sendButtons(
        sock,
        jid,
        text,
        [
            { type: 'copy', label: 'Copy Email', code: entry.email },
            { type: 'reply', label: 'Ganti Email', id: ids.confirmCreate },
            { type: 'reply', label: 'Cek Inbox', id: ids.check },
        ],
        opts
    )
}

function sendInboxMenu(sock, jid, text, ctx, opts = {}) {
    const ids = btnIds(ctx.prefix, ctx.cmd)
    return sendButtons(
        sock,
        jid,
        text,
        [
            { type: 'reply', label: 'Refresh', id: ids.refresh },
            { type: 'reply', label: 'Raw', id: ids.raw },
            { type: 'reply', label: 'Ganti Email', id: ids.confirmCreate },
        ],
        opts
    )
}

function sendConfirmCreate(sock, jid, entry, ctx, opts = {}) {
    const ids = btnIds(ctx.prefix, ctx.cmd)
    const text =
        `*Ganti Email?*\n\n` +
        `Email aktif sekarang: ${entry.email}\n` +
        `Kalau lanjut, email ini tidak bisa dipakai lagi dan semua pesan di dalamnya ilang.\n\n` +
        `Yakin mau buat email baru?`
    return sendButtons(
        sock,
        jid,
        text,
        [
            { type: 'reply', label: 'Ya, Ganti', id: ids.create },
            { type: 'reply', label: 'Batal', id: ids.menu },
        ],
        opts
    )
}

function formatInboxSummary(entry, mail) {
    return (
        `*Inbox ${entry.email}*\n\n` +
        `Dari: ${mail.from || '-'}\n` +
        `Subjek: ${mail.subject}\n` +
        `Waktu: ${mail.time || '-'}\n\n` +
        `${truncate(mail.bodyText, 800)}` +
        linkPreviewBlock(mail.bodyHtml) +
        `\n\n_Isi lengkap + analisis link: tombol Raw_`
    )
}

function formatEmptyInbox(entry) {
    return `*Inbox ${entry.email}*\n\nBelum ada pesan masuk.`
}

function formatNewMailNotif(entry, mail) {
    return (
        `*Email Baru Masuk*\n\n` +
        `Ke: ${entry.email}\n` +
        `Dari: ${mail.from || '-'}\n` +
        `Subjek: ${mail.subject}` +
        linkPreviewBlock(mail.bodyHtml) +
        `\n\n_Detail lengkap: tombol Refresh di bawah_`
    )
}

function formatRawMessage(entry, bodyHtml) {
    const links = extractLinks(bodyHtml)
    const masked = findMaskedLinks(bodyHtml)

    const linkBlock = links.length
        ? `\n\n*Link ditemukan (${links.length})*\n${links.map((l, i) => `${i + 1}. ${l}`).join('\n')}`
        : ''

    const maskedBlock = masked.length
        ? `\n\n*Link tersembunyi di balik teks (${masked.length})*\n` +
          masked.map((a, i) => `${i + 1}. Teks: "${a.label}"\n   URL asli: ${a.href}`).join('\n\n')
        : ''

    return `*Raw ${entry.email}*\n\n` + truncate(htmlToText(bodyHtml), 3000) + linkBlock + maskedBlock
}

let sockRef = null
let pollingStarted = false

async function pollOnce() {
    if (!sockRef) return

    for (const [sender, entry] of Object.entries(TempMailStore.all())) {
        if (!entry?.email || !entry?.cookies) continue

        try {
            const cookieMap = cookieObjToMap(entry.cookies)
            const mail = await client.checkInbox(cookieMap, entry.metaToken)
            entry.cookies = cookieMapToObj(cookieMap)

            if (!mail || mail.mid === entry.lastMid) continue

            entry.lastMid = mail.mid
            entry.lastBodyHtml = mail.bodyHtml

            const prefix = global.prefix || '.'
            const cmd = entry.cmd || 'tempmail'
            await sendInboxMenu(sockRef, sender, formatNewMailNotif(entry, mail), { prefix, cmd })
        } catch {}
    }
}

function startPolling() {
    if (pollingStarted) return
    pollingStarted = true
    setInterval(pollOnce, POLL_INTERVAL_MS)
}

async function cmdDomains(m) {
    try {
        const { cookieMap, metaToken, html } = await client.initSession()
        const domains = await client.fetchDomains(cookieMap, metaToken, html)

        if (!domains.length) return m.reply('Gagal ambil daftar domain.')

        const list = domains.slice(0, 20).map((d, i) => `${i + 1}. ${d}`).join('\n')
        return m.reply(`*Domain Tersedia*\n\n${list}\n\n_Pakai: .tempmail create [alias] [domain]_`)
    } catch (e) {
        return m.reply(`Gagal ambil domain: ${e.message}`)
    }
}

async function cmdCreate(m, ctx, aliasArg, domainArg) {
    const { sock } = ctx

    try {
        const { cookieMap, metaToken, html } = await client.initSession()
        const domains = await client.fetchDomains(cookieMap, metaToken, html)
        if (!domains.length) return m.reply('Gagal ambil daftar domain, coba lagi.')

        const domain = domains.find(d => d.toLowerCase() === domainArg?.toLowerCase())
            || domains[Math.floor(Math.random() * domains.length)]
        const user = aliasArg || randomUser(8)
        const email = `${user}@${domain}`

        await client.selectEmail(cookieMap, domain, user)

        const entry = TempMailStore.save(m.sender, {
            email, domain, user,
            cookies: cookieMapToObj(cookieMap),
            metaToken,
            lastMid: '',
            lastBodyHtml: '',
            cmd: ctx.cmd,
        })

        const text = `*Email Sementara Dibuat*\n\nEmail: ${email}\n\n_Pesan baru otomatis dikirim ke sini, tidak perlu cek manual._`
        return sendMainMenu(sock, m.chat, text, ctx, entry, { quoted: m })
    } catch (e) {
        return m.reply(`Gagal membuat email: ${e.message}`)
    }
}

async function cmdCheck(m, ctx) {
    const { sock } = ctx
    const entry = TempMailStore.get(m.sender)
    if (!entry?.email || !entry?.cookies) {
        return sendCreateOnlyButton(sock, m.chat, 'Belum ada email aktif.', ctx, { quoted: m })
    }

    try {
        const cookieMap = cookieObjToMap(entry.cookies)
        const mail = await client.checkInbox(cookieMap, entry.metaToken)
        entry.cookies = cookieMapToObj(cookieMap)

        if (!mail) return sendInboxMenu(sock, m.chat, formatEmptyInbox(entry), ctx, { quoted: m })

        entry.lastMid = mail.mid
        entry.lastBodyHtml = mail.bodyHtml

        return sendInboxMenu(sock, m.chat, formatInboxSummary(entry, mail), ctx, { quoted: m })
    } catch (e) {
        return m.reply(`Gagal cek inbox: ${e.message}`)
    }
}

async function cmdRefresh(m, ctx) {
    return cmdCheck(m, ctx)
}

async function cmdRaw(m, ctx) {
    const { sock } = ctx
    const entry = TempMailStore.get(m.sender)
    if (!entry?.email) {
        return sendCreateOnlyButton(sock, m.chat, 'Belum ada email aktif.', ctx, { quoted: m })
    }
    if (!entry?.lastBodyHtml) {
        return sendInboxMenu(sock, m.chat, 'Belum ada pesan yang dicek. Tekan Refresh dulu.', ctx, { quoted: m })
    }

    return sendInboxMenu(sock, m.chat, formatRawMessage(entry, entry.lastBodyHtml), ctx, { quoted: m })
}

async function cmdConfirmCreate(m, ctx) {
    const { sock } = ctx
    const entry = TempMailStore.get(m.sender)

    if (!entry?.email) return cmdCreate(m, ctx)

    return sendConfirmCreate(sock, m.chat, entry, ctx, { quoted: m })
}

async function cmdMenu(m, ctx) {
    const { sock } = ctx
    const entry = TempMailStore.get(m.sender)

    if (!entry?.email) {
        return sendCreateOnlyButton(sock, m.chat, 'Belum ada email sementara aktif.', ctx, { quoted: m })
    }

    return sendMainMenu(sock, m.chat, `*Email Aktif*\n\n${entry.email}`, ctx, entry, { quoted: m })
}

function cmdHelp(m, prefix, cmd) {
    return m.reply(
        `*TempMail*\n\n` +
        `${prefix}${cmd}\n   Tampilkan tombol buat email / menu email aktif\n\n` +
        `${prefix}${cmd} create [alias] [domain]\n   Buat / ganti email sementara\n\n` +
        `${prefix}${cmd} check\n   Cek inbox manual (email aktif)\n\n` +
        `${prefix}${cmd} refresh\n   Refresh status inbox\n\n` +
        `${prefix}${cmd} raw\n   Isi lengkap + analisis link dari pesan terakhir\n\n` +
        `${prefix}${cmd} domains\n   Lihat daftar domain tersedia\n\n` +
        `_Pesan baru otomatis dinotif, tidak wajib pakai check._`
    )
}

const __plugin =  {
    cmd: ['tempmail', 'tm'],
    category: 'tools',

    onConnect: async (sock) => {
        sockRef = sock
        startPolling()
    },

    run: async (m, { sock, text, prefix, cmd }) => {
        const [sub, ...rest] = (text || '').trim().split(/ +/)
        const subCmd = sub ? sub.toLowerCase() : null
        const ctx = { sock, prefix, cmd }

        switch (subCmd) {
            case null:
            case 'menu':
                return cmdMenu(m, ctx)
            case 'create':
                return cmdCreate(m, ctx, rest[0], rest[1])
            case 'confirmcreate':
                return cmdConfirmCreate(m, ctx)
            case 'check':
                return cmdCheck(m, ctx)
            case 'refresh':
                return cmdRefresh(m, ctx)
            case 'raw':
                return cmdRaw(m, ctx)
            case 'domains':
                return cmdDomains(m)
            default:
                return cmdHelp(m, prefix, cmd)
        }
    },
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

handler.command = __plugin.cmd || ['tempmail', 'tm']
handler.help = __plugin.help || __plugin.cmd || ['tempmail', 'tm']
handler.tags = [__plugin.category || 'tools']

export default handler
