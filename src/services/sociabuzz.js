/**
 * Sociabuzz payment gateway — QRIS only.
 * Runs only on the backend. Never expose cookies/tokens to the client.
 */
import axios from 'axios'
import * as cheerio from 'cheerio'
import logger from '../utils/logger.js'

const config = {
  username: process.env.SOCIABUZZ_USERNAME || 'reyzdesu',
  baseUrl: 'https://sociabuzz.com',
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  timeout: 20000,
}

const QRIS = {
  type_payment: 'qris',
  source_payment: 'xendit',
  group: 'qris',
  min: 1000,
}

const EXPIRY_MS = 30 * 60 * 1000

/** Per-process cookie jar (not shared across workers — fine for create+status on same instance). */
let jar = ''

const api = axios.create({
  timeout: config.timeout,
  headers: { 'User-Agent': config.userAgent },
  validateStatus: (s) => s >= 200 && s < 500,
})

api.interceptors.response.use((r) => {
  const cookies = r.headers['set-cookie']
  if (cookies) {
    for (const c of cookies) {
      const [kv] = c.split(';')
      const idx = kv.indexOf('=')
      if (idx === -1) continue
      setCookie(kv.slice(0, idx), kv.slice(idx + 1))
    }
  }
  return r
})

api.interceptors.request.use((c) => {
  if (jar && c.url?.includes('sociabuzz')) c.headers.Cookie = jar
  return c
})

function setCookie(name, value) {
  if (!name || value === undefined || value === null) return
  const re = new RegExp('(^|;\\s*)' + name + '=[^;]*')
  if (jar.match(re)) jar = jar.replace(re, '$1' + name + '=' + value)
  else jar = (jar ? jar + '; ' : '') + name + '=' + value
}

function getCsrfFromJar() {
  const m = jar.match(/csrf_cookie_name=([^;]+)/)
  return m ? m[1] : null
}

function cleanAmount(v) {
  return Number(String(v || '').replace(/[^\d]/g, ''))
}

/**
 * Create a QRIS payment for the given amount.
 * @returns payment details including qr_string, inv_id, pending_url, order_id
 */
export async function createQrisPayment(amount, opts = {}) {
  const {
    name = 'Botenv User',
    message = 'Upgrade plan botenv',
    email,
    username = config.username,
  } = opts

  amount = cleanAmount(amount)
  if (!amount || amount < QRIS.min) {
    throw new Error(`Minimal Rp ${QRIS.min.toLocaleString('id-ID')} untuk QRIS`)
  }

  // Fresh cookie jar per payment attempt to avoid stale CSRF
  jar = ''

  const donateUrl = `${config.baseUrl}/${username}/donate`

  let home
  try {
    home = await api.get(donateUrl, { headers: { Accept: 'text/html' } })
  } catch (err) {
    throw new Error(`Gagal membuka halaman donasi: ${err.message}`)
  }

  const $ = cheerio.load(home.data || '')
  const csrf = $('input[name="sb_token_csrf"]').val()
  if (!csrf) {
    throw new Error(
      'Gagal mengambil CSRF token. Username Sociabuzz tidak valid atau halaman berubah.'
    )
  }

  const body = {
    sb_token_csrf: csrf,
    currency: 'IDR',
    amount: String(amount),
    qty: '1',
    support_duration: '30',
    note: message || '',
    fullname: name,
    email: email || `user${Date.now()}@gmail.com`,
    is_agree: '1',
    years18: '1',
    is_vote: '0',
    is_voice: '0',
    is_mediashare: '0',
    is_gif: '0',
    is_sound: '0',
    is_voicy: '0',
    vote_id: '',
    ms_maxtime: '',
    start_from: '0',
    ms_starthour: '0',
    ms_startminute: '0',
    ms_startsecond: '0',
    spin_check: '0',
    prev_url: donateUrl,
    hide_email: '0',
    is_tiktok: '0',
    tiktok_duration: '0',
    is_instagram: '0',
    instagram_duration: '0',
    wishlist_id: '',
    quickpay: '0',
  }

  let sub
  try {
    sub = await api.post(
      `${donateUrl}/get-form-queue`,
      new URLSearchParams(body).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: config.baseUrl,
          Referer: donateUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
      }
    )
  } catch (err) {
    throw new Error(`Gagal mengirim form donasi: ${err.message}`)
  }

  if (sub.data?.success !== 'true') {
    throw new Error(sub.data?.content?.form_alert || 'Gagal membuat donasi')
  }

  const paymentUrl = sub.data.content?.redirect
  const token = paymentUrl?.split('/payment/x/')[1]?.split(/[?#]/)[0]
  if (!token) {
    throw new Error('Tidak bisa mengekstrak order token dari Sociabuzz')
  }

  const pay = await api.get(paymentUrl, { headers: { Accept: 'text/html' } })
  const $pay = cheerio.load(pay.data || '')
  let csrf2 = $pay('input[name="sb_token_csrf"]').val()
  if (csrf2) setCookie('sociabuzz_sb_cookie_csrf', csrf2)

  await api.get(`${config.baseUrl}/payment/pay/setting`, {
    params: {
      amount: String(amount),
      currency: 'IDR',
      base_amount: String(amount),
      base_currency: 'IDR',
      currency_def: 'IDR',
      convertion: 'IDR',
      country: 'Indonesia',
      feature: 'TRIBE',
      is_borne_fee: '1',
      risk: '',
      message: '',
      direct: '',
      service_fee: '1',
      token,
      country_account: '',
    },
  })

  const c = getCsrfFromJar()
  if (c) {
    setCookie('sociabuzz_sb_cookie_csrf', c)
    csrf2 = c
  }
  if (!csrf2) {
    throw new Error('Gagal mengambil CSRF token pembayaran')
  }

  let res
  try {
    res = await api.post(
      `${config.baseUrl}/payment/send/create`,
      {
        sb_token_csrf: csrf2,
        order_id: token,
        final_currency: 'IDR',
        currency_def: 'IDR',
        payment_method: 'qris',
        type_payment: QRIS.type_payment,
        source_payment: QRIS.source_payment,
        country: 'ID',
        country_pay: 'Indonesia',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: config.baseUrl,
          Referer: paymentUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
      }
    )
  } catch (err) {
    throw new Error(`Gagal membuat transaksi QRIS: ${err.message}`)
  }

  if (!res.data?.status) {
    throw new Error(res.data?.message || 'Respons pembayaran tidak valid')
  }

  const rd = res.data
  const total = cleanAmount(rd.data?.amount || rd.data?.total || amount)
  const fee = Math.max(0, total - amount)
  const invId = rd.inv_id || rd.data?.id || null
  const qrString = rd.data?.qr_string || null
  const pendingUrl = invId
    ? `${config.baseUrl}/payment/pending?type=${rd.payment_method || 'qris'}&inv_id=${invId}`
    : null

  if (!qrString) {
    logger.warn({ invId }, 'QRIS created without qr_string')
  }

  return {
    orderId: token,
    invId,
    pendingUrl,
    paymentUrl,
    qrString,
    amount,
    totalAmount: total,
    fee,
    expiredAt: new Date(Date.now() + EXPIRY_MS),
    method: 'qris',
    raw: {
      payment_method: rd.payment_method,
      type_payment: rd.type_payment,
      source_payment: rd.source_payment,
    },
  }
}

/**
 * Check payment status once (no polling). Parses Sociabuzz pending page title.
 */
export async function checkPaymentStatus(pendingUrl) {
  if (!pendingUrl) {
    return { status: 'unknown', title: '' }
  }
  try {
    const res = await api.get(pendingUrl, {
      headers: { Accept: 'text/html' },
      timeout: 15000,
      validateStatus: () => true,
    })
    const title = (String(res.data || '').match(/<title>([^<]+)/) || ['', ''])[1] || ''
    const t = title.toLowerCase()
    let status = 'unknown'
    if (t.includes('pending')) status = 'pending'
    else if (t.includes('success') || t.includes('berhasil')) status = 'paid'
    else if (t.includes('expired') || t.includes('kadaluarsa')) status = 'expired'
    else if (t.includes('not found') || t.includes('tidak ditemukan')) status = 'failed'
    else if (t.includes('fail') || t.includes('gagal')) status = 'failed'
    return { status, title }
  } catch (err) {
    logger.warn({ err: err.message }, 'Sociabuzz status check failed')
    throw new Error('Gagal mengecek status pembayaran. Coba lagi.')
  }
}

export default { createQrisPayment, checkPaymentStatus }
