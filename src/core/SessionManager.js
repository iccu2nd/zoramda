/**
 * Multi-session orchestrator.
 * Every session is fully isolated – no shared locks, no global queues.
 */
import { v4 as uuidv4 } from 'uuid'
import Session from '../db/models/Session.js'
import ConnectionManager, { STATES } from './ConnectionManager.js'
import MessageHandler from './MessageHandler.js'
import PluginLoader from './PluginLoader.js'
import logger from '../utils/logger.js'
import config from '../config/index.js'
import configService from './ConfigService.js'

export class SessionManager {
  constructor() {
    /** @type {Map<string, ConnectionManager>} */
    this.sessions = new Map()
    this.pluginLoader = new PluginLoader()
    this.messageHandler = null
    this.initialized = false
  }

  async init() {
    if (this.initialized) return
    await this.pluginLoader.init()
    this.messageHandler = new MessageHandler(this.pluginLoader)

    // Restore previously active sessions from DB (background, non-blocking)
    this._restoreSessions().catch((err) => {
      logger.error({ err: err.message }, 'Session restore failed')
    })

    this.initialized = true
    logger.info('SessionManager ready')
  }

  async _restoreSessions() {
    const active = await Session.find({
      isActive: true,
      status: { $in: [STATES.CONNECTED, STATES.RECONNECTING, STATES.CONNECTING, STATES.QR, STATES.PAIRING] },
    }).lean()

    logger.info({ count: active.length }, 'Restoring sessions')

    // Parallel restore with concurrency limit — faster boot, no thundering herd
    const CONCURRENCY = 5
    let idx = 0
    const runNext = async () => {
      while (idx < active.length) {
        const s = active[idx++]
        try {
          await this._startConnection(s.sessionId, { userId: s.userId })
        } catch (err) {
          logger.error({ sessionId: s.sessionId, err: err.message }, 'Restore start failed')
        }
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, active.length) }, () => runNext())
    await Promise.all(workers)
  }

  /**
   * Create a new session for a user
   */
  async createSession(userId, { name = '', pairingPhone } = {}) {
    // Limit from user plan (DB), not only env
    const User = (await import('../db/models/User.js')).default
    const user = await User.findOne({ userId }).lean()
    const count = await Session.countDocuments({ userId, isActive: true })
    let maxSessions = user?.maxSessions
    if (maxSessions == null) maxSessions = config.session.maxPerUser
    if (user?.role === 'admin') maxSessions = Math.max(maxSessions, config.session.maxPerUser)
    // expired plan → fall back to free limit
    if (
      user?.plan &&
      user.plan !== 'free' &&
      user.planExpiresAt &&
      new Date(user.planExpiresAt).getTime() < Date.now()
    ) {
      maxSessions = 1
    }
    if (count >= maxSessions) {
      const err = new Error(
        `Batas session paket kamu (${maxSessions}) sudah penuh. Upgrade di menu Pricing.`
      )
      err.code = 'MAX_SESSIONS'
      throw err
    }

    const sessionId = uuidv4()
    await Session.create({
      sessionId,
      userId,
      name: name || `Session ${sessionId.slice(0, 8)}`,
      status: STATES.CREATING,
      isActive: true,
    })

    await this._startConnection(sessionId, { userId, pairingPhone })
    return this.getSessionInfo(sessionId)
  }

  async _startConnection(sessionId, opts = {}) {
    if (this.sessions.has(sessionId)) {
      // already running
      return this.sessions.get(sessionId)
    }

    const cm = new ConnectionManager(sessionId, {
      userId: opts.userId,
      messageHandler: this.messageHandler,
      onStatusChange: (id, status) => {
        logger.debug({ sessionId: id, status }, 'Session status change')
      },
    })

    this.sessions.set(sessionId, cm)
    await cm.start(opts)
    return cm
  }

  async connect(sessionId, { pairingPhone } = {}) {
    const session = await Session.findOne({ sessionId, isActive: true })
    if (!session) {
      const err = new Error('Session not found')
      err.code = 'NOT_FOUND'
      throw err
    }

    let cm = this.sessions.get(sessionId)
    if (cm && cm.status === STATES.CONNECTED) {
      return cm.getStatus()
    }

    if (cm) {
      await cm.stop()
      this.sessions.delete(sessionId)
    }

    cm = await this._startConnection(sessionId, { userId: session.userId, pairingPhone })
    return cm.getStatus()
  }

  async disconnect(sessionId, { logout = false } = {}) {
    const cm = this.sessions.get(sessionId)
    if (cm) {
      await cm.stop({ logout })
      this.sessions.delete(sessionId)
    } else {
      await Session.findOneAndUpdate(
        { sessionId },
        { status: STATES.STOPPED, qr: null, pairingCode: null }
      )
    }
    return { sessionId, status: STATES.STOPPED }
  }

  async deleteSession(sessionId) {
    await this.disconnect(sessionId, { logout: true })
    await Session.findOneAndUpdate(
      { sessionId },
      { isActive: false, status: STATES.STOPPED, qr: null, pairingCode: null }
    )
    await configService.deleteSessionConfig(sessionId)
    return { deleted: true }
  }

  getSessionInfo(sessionId) {
    const cm = this.sessions.get(sessionId)
    if (cm) return cm.getStatus()
    // fallback to DB
    return Session.findOne({ sessionId }).lean().then((s) => {
      if (!s) return null
      return {
        sessionId: s.sessionId,
        status: s.status,
        qr: s.qr,
        pairingCode: s.pairingCode,
        phoneNumber: s.phoneNumber,
        name: s.name,
      }
    })
  }

  async listSessions(userId, { includeInactive = false } = {}) {
    const filter = { userId }
    if (!includeInactive) filter.isActive = true
    const docs = await Session.find(filter).sort({ createdAt: -1 }).lean()
    return docs.map((s) => {
      const live = this.sessions.get(s.sessionId)
      return {
        sessionId: s.sessionId,
        name: s.name,
        status: live ? live.status : s.status,
        phoneNumber: live?.phoneNumber || s.phoneNumber,
        qr: live?.qr || s.qr,
        pairingCode: live?.pairingCode || s.pairingCode,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }
    })
  }

  async getQr(sessionId) {
    const cm = this.sessions.get(sessionId)
    if (cm) return { qr: cm.qr, status: cm.status }
    const s = await Session.findOne({ sessionId }).lean()
    return s ? { qr: s.qr, status: s.status } : null
  }

  async getPairingCode(sessionId) {
    const cm = this.sessions.get(sessionId)
    if (cm) return { pairingCode: cm.pairingCode, status: cm.status, pairingError: cm.pairingError }
    const s = await Session.findOne({ sessionId }).lean()
    return s ? { pairingCode: s.pairingCode, status: s.status, pairingError: s.lastError } : null
  }

  /**
   * Ownership check helper for API
   */
  async assertOwnership(sessionId, userId, isAdmin = false) {
    if (isAdmin) return true
    const s = await Session.findOne({ sessionId, userId, isActive: true }).lean()
    if (!s) {
      const err = new Error('Session not found or access denied')
      err.code = 'FORBIDDEN'
      throw err
    }
    return true
  }

  async shutdown() {
    logger.info('Shutting down all sessions...')
    const stops = []
    for (const [id, cm] of this.sessions) {
      stops.push(
        cm.stop().catch((err) => {
          logger.warn({ sessionId: id, err: err.message }, 'Error stopping session')
        })
      )
    }
    await Promise.allSettled(stops)
    this.sessions.clear()
    await this.pluginLoader.stop()
  }
}

export default SessionManager
