import * as cheerio from "cheerio"

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36"

class MyInstants {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || "https://www.myinstants.com"
    this.delayMs = options.delayMs ?? 1000
    this.maxRetries = options.maxRetries ?? 3
    this.timeoutMs = options.timeoutMs ?? 30000
    this.headers = {
      "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      Referer: `${this.baseUrl}/`
    }
  }

  _absUrl(url) {
    if (!url) return null
    try { return new URL(url, this.baseUrl).toString() } catch { return null }
  }

  _cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim()
  }

  _extractAudioPath(onclick = "") {
    const match = String(onclick).match(/play\(\s*['"]([^'"]+)['"]/)
    return match?.[1] || null
  }

  _extractSlug(onclick = "") {
    const match = String(onclick).match(/play\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]\s*\)/)
    return match?.[1] || null
  }

  async _fetch(url, options = {}) {
    let lastError = null
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const response = await fetch(url, {
          ...options,
          headers: { ...this.headers, ...(options.headers || {}) },
          signal: controller.signal,
          redirect: "follow"
        })
        clearTimeout(timer)
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          throw new Error(`HTTP ${response.status}`)
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response
      } catch (error) {
        clearTimeout(timer)
        lastError = error
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, this.delayMs * attempt))
        }
      }
    }
    throw lastError || new Error("Fetch failed")
  }

  async getHtml(url) {
    const response = await this._fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    })
    return response.text()
  }

  async search(query, page = 1) {
    const url = new URL(this.baseUrl + "/en/search/")
    url.searchParams.set("name", query)
    if (page > 1) url.searchParams.set("page", page)
    const html = await this.getHtml(url.toString())
    const $ = cheerio.load(html)
    const items = []
    $(".instant").each((_, element) => {
      const $el = $(element)
      const link = $el.find("a.instant-link")
      const button = $el.find("button.small-button")
      const onclick = button.attr("onclick") || ""
      const href = link.attr("href") || ""
      const title = this._cleanText(link.text() || "")
      const audioPath = this._extractAudioPath(onclick)
      const slug = this._extractSlug(onclick) || href.split("/").filter(Boolean).pop() || null
      items.push({ title, slug, pageUrl: href ? this._absUrl(href) : null, mp3Url: audioPath ? this._absUrl(audioPath) : null })
    })
    return items
  }

  async getDetail(slug) {
    const url = this._absUrl(`/en/instant/${slug}/`)
    const html = await this.getHtml(url)
    const preloadMatch = html.match(/var\s+preloadAudioUrl\s*=\s*['"]([^'"]+)['"]/)
    let mp3Url = preloadMatch?.[1] ||
      html.match(/<meta\s+property="og:audio"\s+content="([^"]+)"/)?.[1] ||
      this._extractAudioPath(html.match(/id="instant-page-button-element".*?onclick="([^"]+)"/)?.[1] || "")
    mp3Url = mp3Url ? this._absUrl(mp3Url) : null
    const titleMatch = html.match(/<title>(.*?)<\/title>/)
    const title = titleMatch ? titleMatch[1].split(" - ")[0].trim() : slug
    return { mp3Url, title }
  }
}

const sessions = new Map()

function getSession(sender) {
  if (!sessions.has(sender)) {
    sessions.set(sender, { results: [], query: "", step: "idle" })
  }
  return sessions.get(sender)
}

const __plugin =  {
  cmd: ['sfx', 'soundfx', 'sound'],
  category: 'downloader',
  description: 'Cari dan download sound effect',

  run: async (m, { sock, text, prefix, cmd, config }) => {
    const sender = m.sender
    const session = getSession(sender)

    if (text && /^\d+$/.test(text.trim())) {
      const index = parseInt(text.trim()) - 1
      if (session.results && session.results.length > index) {
        const selected = session.results[index]
        if (!selected?.slug) {
          return m.reply('Sound tidak valid. Cari ulang dengan .sfx <query>')
        }
        await m.reply(`Mengambil audio: ${selected.title}...`)
        try {
          const scraper = new MyInstants()
          const detail = await scraper.getDetail(selected.slug)
          if (!detail.mp3Url) return m.reply('Gagal mendapatkan link audio.')
          const audioRes = await fetch(detail.mp3Url, {
            headers: { 'User-Agent': DEFAULT_USER_AGENT, 'Referer': 'https://www.myinstants.com/' }
          })
          if (!audioRes.ok) throw new Error('Gagal download audio')
          const audioBuffer = Buffer.from(await audioRes.arrayBuffer())
          await sock.sendAudio(m.chat, audioBuffer, true, m)
          session.step = "idle"
          session.results = []
        } catch (e) {
          console.error(e)
          await m.reply(`Error: ${e.message || 'Terjadi kesalahan'}`)
        }
        return
      } else {
        return m.reply('Nomor tidak valid. Silakan pilih dari daftar yang tersedia.')
      }
    }

    if (!text) {
      return m.reply(
        `Sound Effect Downloader\n\n` +
        `- ${prefix}${cmd} <query>\n\n` +
        `Contoh:\n` +
        `${prefix}${cmd} saya akan lawan\n` +
        `${prefix}${cmd} vine boom\n` +
        `${prefix}${cmd} sad violin`
      )
    }

    await m.reply(`Mencari: ${text}...`)

    try {
      const scraper = new MyInstants()
      const results = await scraper.search(text, 1)
      if (!results || results.length === 0) {
        return m.reply(`Tidak ditemukan sound effect untuk: ${text}`)
      }
      session.results = results
      session.query = text
      session.step = "selecting"

      const rows = results.slice(0, 10).map(r => ({
        title: r.title.length > 60 ? r.title.slice(0, 57) + '...' : r.title,
        description: `Download sound effect ini`,
        id: `.sfx ${results.indexOf(r) + 1}`
      }))

      await sock.sendInteractiveButton(m.chat, {
        title: 'Hasil Sound Effect',
        body: `Ditemukan ${results.length} sound effect untuk "${text}".\nTap salah satu untuk download.`,
        footer: config.botName,
        buttons: [{
          type: 'list',
          label: `Pilih Sound (${Math.min(results.length, 10)})`,
          sections: [{
            title: 'Hasil Pencarian',
            rows: rows
          }]
        }]
      }, { quoted: m })

    } catch (e) {
      console.error(e)
      await m.reply(`Error: ${e.message || 'Terjadi kesalahan'}`)
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

handler.command = __plugin.cmd || ['sfx', 'soundfx', 'sound']
handler.help = __plugin.help || __plugin.cmd || ['sfx', 'soundfx', 'sound']
handler.tags = [__plugin.category || 'downloader']
handler.heavy = true

export default handler
