/**
 * Bounded concurrent job queue — keeps the event loop responsive under load.
 * - Light work runs fire-and-forget (MessageHandler)
 * - Heavy plugins share a global concurrency cap
 * - Per-session in-flight cap prevents one busy session from starving others
 */

const HEAVY_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.HEAVY_QUEUE_CONCURRENCY || '4', 10) || 4
)
const SESSION_MAX_INFLIGHT = Math.max(
  2,
  parseInt(process.env.SESSION_MAX_INFLIGHT || '12', 10) || 12
)

export class JobQueue {
  /**
   * @param {{ concurrency?: number, name?: string }} opts
   */
  constructor({ concurrency = 4, name = 'jobs' } = {}) {
    this.concurrency = Math.max(1, concurrency)
    this.name = name
    this.running = 0
    /** @type {Array<{ run: () => Promise<any>, resolve: Function, reject: Function }>} */
    this.queue = []
  }

  get pending() {
    return this.queue.length
  }

  get active() {
    return this.running
  }

  /**
   * @template T
   * @param {() => Promise<T>|T} fn
   * @returns {Promise<T>}
   */
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        run: async () => fn(),
        resolve,
        reject,
      })
      this._pump()
    })
  }

  /** Fire-and-forget */
  push(fn) {
    this.enqueue(fn).catch(() => {})
  }

  _pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()
      this.running++
      Promise.resolve()
        .then(() => job.run())
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running--
          this._pump()
        })
    }
  }
}

/** Global pool for heavy plugins (download, broadcast, group ops, media) */
export const heavyQueue = new JobQueue({
  concurrency: HEAVY_CONCURRENCY,
  name: 'heavy',
})

/** Per-session in-flight command limiter (memory only) */
const sessionInflight = new Map()

export function tryAcquireSessionSlot(sessionId) {
  const n = sessionInflight.get(sessionId) || 0
  if (n >= SESSION_MAX_INFLIGHT) return false
  sessionInflight.set(sessionId, n + 1)
  return true
}

export function releaseSessionSlot(sessionId) {
  const n = sessionInflight.get(sessionId) || 0
  if (n <= 1) sessionInflight.delete(sessionId)
  else sessionInflight.set(sessionId, n - 1)
}

export default { JobQueue, heavyQueue, tryAcquireSessionSlot, releaseSessionSlot }
