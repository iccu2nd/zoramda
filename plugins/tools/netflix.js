import axios from 'axios'
import crypto from 'crypto'

const CONFIG = {
  SITE: 'http://nftools.aroshi.my.id',
  TIMEOUT: 15000,
  UA_POOL: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
  ],
  PLANS: ['premium', 'standard', 'basic'],
  PROXY_SOURCES: [
    'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=2000&count=50',
    'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
  ]
}

function pickUA() {
  return CONFIG.UA_POOL[Math.floor(Math.random() * CONFIG.UA_POOL.length)]
}

function browserHeaders(extra = {}) {
  return {
    'User-Agent': pickUA(),
    'Accept': '*/*',
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': CONFIG.SITE,
    'Referer': CONFIG.SITE + '/nftoken',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    ...extra
  }
}

function parseProxyLine(line) {
  line = line.trim()
  if (!line) return null
  if (line.startsWith('http://') || line.startsWith('https://')) {
    try {
      const u = new URL(line)
      return { host: u.hostname, port: Number(u.port || 80), protocol: u.protocol }
    } catch { return null }
  }
  const match = line.match(/^([^:]+):(\d+)(?::([^:]+):([^:]+))?$/)
  if (!match) return null
  return { host: match[1], port: Number(match[2]) }
}

async function fetchProxies() {
  let allLines = []
  for (const src of CONFIG.PROXY_SOURCES) {
    try {
      const res = await axios.get(src, { timeout: 20000 })
      allLines.push(...res.data.split(/\r?\n/))
    } catch {}
  }
  const seen = new Set()
  const proxies = []
  for (const line of allLines) {
    const p = parseProxyLine(line)
    if (p && !seen.has(p.host + ':' + p.port)) {
      seen.add(p.host + ':' + p.port)
      proxies.push(p)
    }
  }
  return proxies
}

function solvePow(challenge, prefix = '0000') {
  for (let n = 0; n < 1000000; n++) {
    if (crypto.createHash('sha256').update(challenge + n).digest('hex').startsWith(prefix)) {
      return `${challenge}:${n}`
    }
  }
  return null
}

async function newSession(proxy) {
  try {
    const res = await axios.post(`${CONFIG.SITE}/api/session`, {}, {
      headers: browserHeaders(),
      proxy: { host: proxy.host, port: proxy.port, protocol: proxy.protocol || 'http' },
      timeout: CONFIG.TIMEOUT
    })
    if (!res.data.success || !res.data.token) throw new Error(res.data.error || 'Gagal session')
    return res.data
  } catch (e) {
    throw new Error(e.response?.data?.error || e.message)
  }
}

async function genToken(proxy, sessionToken, plan = 'premium') {
  try {
    const res = await axios.post(`${CONFIG.SITE}/api/random`, { plan }, {
      headers: { ...browserHeaders(), 'X-NFToken-Session': sessionToken },
      proxy: { host: proxy.host, port: proxy.port, protocol: proxy.protocol || 'http' },
      timeout: CONFIG.TIMEOUT
    })
    return res.data
  } catch (e) {
    if (e.response?.status === 403 && e.response?.data?.powChallenge) {
      const proof = solvePow(e.response.data.powChallenge)
      if (!proof) throw new Error('Gagal PoW')
      const retry = await axios.post(`${CONFIG.SITE}/api/random`, { plan }, {
        headers: { ...browserHeaders(), 'X-NFToken-Session': sessionToken, 'X-PoW-Proof': proof },
        proxy: { host: proxy.host, port: proxy.port, protocol: proxy.protocol || 'http' },
        timeout: CONFIG.TIMEOUT
      })
      return retry.data
    }
    throw new Error(e.response?.data?.error || e.message)
  }
}

async function testProxy(proxy) {
  try {
    const session = await newSession(proxy)
    return { valid: true, session }
  } catch {
    return { valid: false }
  }
}

async function generateMultipleTokens(count = 5, plan = null) {
  const results = []
  const proxies = await fetchProxies()
  if (!proxies.length) throw new Error('Tidak ada proxy tersedia')

  let proxyIndex = 0
  let attempts = 0
  const maxAttempts = proxies.length * 2

  while (results.length < count && attempts < maxAttempts) {
    attempts++
    const proxy = proxies[proxyIndex % proxies.length]
    proxyIndex++

    try {
      const test = await testProxy(proxy)
      if (!test.valid) continue

      const currentPlan = plan || CONFIG.PLANS[results.length % CONFIG.PLANS.length]
      const token = await genToken(proxy, test.session.token, currentPlan)

      if (token.success && token.url) {
        results.push({
          plan: currentPlan,
          url: token.url,
          expires: token.expires,
          quality: token.quality,
          country: token.country,
          proxy: `${proxy.host}:${proxy.port}`
        })
      }
    } catch (e) {}
  }
  return results
}

const __plugin =  {
  cmd: ['nftoken', 'nf'],
  category: 'tools',
  description: 'Generate token Netflix via proxy rotation',

  run: async (m, { sock, text, prefix, cmd }) => {
    const args = text.trim().split(/\s+/)
    const sub = args[0]?.toLowerCase() || ''

    if (!sub) {
      return m.reply(
        `Netflix Token Generator\n\n` +
        `- ${prefix}${cmd} gen <jumlah>  - Generate token (default 1)\n` +
        `- ${prefix}${cmd} plan <plan>  - Set plan (premium/standard/basic)\n` +
        `- ${prefix}${cmd} stats        - Lihat statistik\n\n` +
        `Contoh: ${prefix}${cmd} gen 5`
      )
    }

    if (sub === 'gen' || sub === 'generate') {
      const count = parseInt(args[1]) || 1
      if (count < 1 || count > 50) return m.reply('Jumlah token 1-50')

      await m.reply(`Memproses ${count} token... (bisa memakan waktu beberapa menit)`)

      try {
        const plan = process.env.NFT_PLAN || null
        const results = await generateMultipleTokens(count, plan)

        if (!results || results.length === 0) {
          return m.reply('Gagal mendapatkan token. Coba lagi nanti.')
        }

        let msg = `Netflix Tokens (${results.length})\n\n`
        results.forEach((r, i) => {
          msg += `${i+1}. [${r.plan}] ${r.url}\n`
          msg += `   Exp: ${r.expires} | ${r.quality} | ${r.country}\n\n`
        })

        await m.reply(msg)
      } catch (e) {
        await m.reply(`Gagal: ${e.message}`)
      }
      return
    }

    if (sub === 'plan') {
      const plan = args[1]?.toLowerCase()
      if (!plan || !['premium', 'standard', 'basic'].includes(plan)) {
        return m.reply(`Plan: premium, standard, basic\nContoh: ${prefix}${cmd} plan premium`)
      }
      process.env.NFT_PLAN = plan
      return m.reply(`Plan: ${plan}`)
    }

    if (sub === 'stats') {
      return m.reply(
        `Netflix Token Generator\n\n` +
        `Plan: ${process.env.NFT_PLAN || 'auto (bergantian)'}\n` +
        `Proxy: auto-fetch\n` +
        `Status: siap`
      )
    }

    return m.reply(`Subcommand tidak dikenal. Ketik ${prefix}${cmd} untuk bantuan.`)
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

handler.command = __plugin.cmd || ['nftoken', 'nf']
handler.help = __plugin.help || __plugin.cmd || ['nftoken', 'nf']
handler.tags = [__plugin.category || 'tools']

export default handler
