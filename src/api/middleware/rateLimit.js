/**
 * Minimal in-memory rate limiter, keyed by IP by default.
 * Good enough for a single-instance deployment; if this ever runs as
 * multiple horizontally-scaled instances, replace with a Redis-backed
 * limiter so counts are shared across instances.
 */
const buckets = new Map()

export function rateLimit({ windowMs = 60_000, max = 20, keyFn, message } = {}) {
  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : req.ip) || 'unknown'
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
      return res.status(429).json({
        error: message || 'Terlalu banyak percobaan. Coba lagi nanti.',
      })
    }
    next()
  }
}

// periodic sweep so the map doesn't grow unbounded
const sweeper = setInterval(
  () => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetAt) buckets.delete(key)
    }
  },
  5 * 60_000
)
sweeper.unref?.()

export default { rateLimit }
