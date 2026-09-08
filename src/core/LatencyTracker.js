import logger from '../utils/logger.js'
import config from '../config/index.js'

/**
 * Lightweight per-message latency instrumentation.
 * Does NOT block the hot path.
 *
 * Marks (in order when available):
 *   message_received → handler_started → command_detected →
 *   plugin_started → plugin_exec → reply_started → reply_finished →
 *   plugin_finished → total_latency
 */
export class LatencyTracker {
  constructor(messageId, sessionId) {
    this.messageId = messageId
    this.sessionId = sessionId
    this.marks = Object.create(null)
    this.start = performance.now()
    this.mark('message_received')
  }

  mark(name) {
    this.marks[name] = performance.now()
  }

  finish() {
    const total = performance.now() - this.start
    const order = [
      'message_received',
      'handler_started',
      'command_detected',
      'plugin_started',
      'plugin_exec',
      'reply_started',
      'reply_finished',
      'plugin_finished',
    ]
    const points = {}
    let prev = this.start
    for (const name of order) {
      if (this.marks[name] == null) continue
      points[name] = Math.round(this.marks[name] - prev)
      prev = this.marks[name]
    }
    for (const [name, t] of Object.entries(this.marks)) {
      if (points[name] == null) points[name] = Math.round(t - this.start)
    }
    points.total_latency = Math.round(total)

    if (total >= config.latencyThreshold) {
      logger.warn(
        {
          sessionId: this.sessionId,
          messageId: this.messageId,
          latency: points,
        },
        'High latency detected'
      )
    } else if (config.env !== 'production') {
      logger.debug({ sessionId: this.sessionId, latency: points }, 'Message latency')
    }

    return points
  }
}

export default LatencyTracker
