/**
 * In-memory rate limiter.
 * Keys are namespaced per route/action so login ≠ register ≠ verify.
 * Single-instance only; use Redis if you scale horizontally.
 */
const buckets = new Map()

function clientIp(req) {
  // trust proxy is enabled on the app — prefer Express req.ip
  const ip = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
  return ip || req.socket?.remoteAddress || 'unknown'
}

/**
 * @param {{
 *   windowMs?: number,
 *   max?: number,
 *   name?: string,
 *   keyFn?: (req: any) => string,
 *   message?: string,
 * }} opts
 */
export function rateLimit({
  windowMs = 60_000,
  max = 30,
  name = 'default',
  keyFn,
  message,
} = {}) {
  return (req, res, next) => {
    const identity = keyFn ? keyFn(req) : clientIp(req)
    const key = `${name}:${identity}`
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSec))
      const mins = Math.ceil(retryAfterSec / 60)
      return res.status(429).json({
        error:
          message ||
          `Terlalu banyak percobaan. Coba lagi dalam ${mins} menit.`,
        retryAfterSec,
      })
    }

    // Soft headers for clients that care
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)))

    next()
  }
}

const sweeper = setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key)
  }
}, 5 * 60_000)
sweeper.unref?.()

export default { rateLimit }
