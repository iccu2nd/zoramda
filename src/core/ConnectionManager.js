/**
 * Per-session connection state machine.
 * Isolated – one session error never affects others.
 */
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import pino from 'pino'
import { useMongoAuthState } from '../db/authState.js'
import Session from '../db/models/Session.js'
import logger from '../utils/logger.js'
import config from '../config/index.js'
import configService from './ConfigService.js'
import { serializeError } from '../utils/helpers.js'
import { attachMessageWrappers } from './messageWrappers.js'

const baileysLogger = pino({ level: 'silent' })

/** Cache WA web version across sessions — avoids network on every reconnect */
let cachedWaVersion = null
let cachedWaVersionAt = 0
const WA_VERSION_TTL_MS = 6 * 60 * 60 * 1000

async function getWaVersion() {
  const now = Date.now()
  if (cachedWaVersion && now - cachedWaVersionAt < WA_VERSION_TTL_MS) {
    return cachedWaVersion
  }
  try {
    const { version } = await fetchLatestBaileysVersion()
    cachedWaVersion = version
    cachedWaVersionAt = now
    return version
  } catch {
    return cachedWaVersion || [2, 3000, 1025190524]
  }
}

export const STATES = {
  CREATING: 'CREATING',
  CONNECTING: 'CONNECTING',
  QR: 'QR',
  PAIRING: 'PAIRING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
  STOPPED: 'STOPPED',
}

export class ConnectionManager {
  constructor(sessionId, { userId, messageHandler, onStatusChange } = {}) {
    this.sessionId = sessionId
    this.userId = userId
    this.messageHandler = messageHandler
    this.onStatusChange = onStatusChange || (() => {})

    this.sock = null
    this.status = STATES.CREATING
    this.saveCreds = null
    this.clearAuth = null
    this.qr = null
    this.pairingCode = null
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.pairingTimer = null
    this.isStopping = false
    this.phoneNumber = null
    this.pendingPairingPhone = null
    this._pairingRequested = false
    this._pairingAttempts = 0
    this.pairingError = null
    this._boundHandlers = []
  }

  async setStatus(status, extra = {}) {
    this.status = status
    this.onStatusChange(this.sessionId, status, extra)
    // Persist off the critical path so WS events stay responsive
    const payload = {
      status,
      qr: this.qr,
      pairingCode: this.pairingCode,
      phoneNumber: this.phoneNumber,
      lastError: extra.error || null,
      ...extra.fields,
    }
    Session.findOneAndUpdate({ sessionId: this.sessionId }, payload).catch((err) => {
      logger.error({ sessionId: this.sessionId, err: err.message }, 'Failed to update session status')
    })
  }

  async start({ pairingPhone } = {}) {
    if (this.isStopping) return
    this.isStopping = false
    this._pairingRequested = false

    if (pairingPhone) {
      this.pendingPairingPhone = String(pairingPhone).replace(/\D/g, '')
      this._pairingAttempts = 0
      this.pairingError = null
    }

    try {
      await this.setStatus(STATES.CONNECTING)

      // Warm config in background — message path never awaits DB
      if (this.userId) configService.warm(this.sessionId, this.userId).catch(() => {})

      // Parallel: auth state + WA version (independent I/O)
      const [authBundle, version] = await Promise.all([
        useMongoAuthState(this.sessionId),
        getWaVersion(),
      ])
      const { state, saveCreds, clearAuth } = authBundle
      this.saveCreds = saveCreds
      this.clearAuth = clearAuth

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        logger: baileysLogger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined,
        shouldIgnoreJid: (jid) => jid === 'status@broadcast',
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 40000,
        defaultQueryTimeoutMs: 40000,
        emitOwnEvents: false,
        fireInitQueries: false,
        shouldSyncHistoryMessage: () => false,
        transactionOpts: { maxCommitRetries: 2, delayBetweenTriesMs: 100 },
      })

      // sendSticker / sendAudio / sendAlbum / sendButton wrappers — dipasang
      // sekali di sini supaya semua plugin bisa langsung pakai lewat ctx.conn
      attachMessageWrappers(sock)

      this.sock = sock
      this._attachEvents(sock)

      // Pairing: tunggu websocket siap dulu (jangan langsung request)
      if (this.pendingPairingPhone && !state.creds.registered) {
        this._schedulePairingCode(sock, this.pendingPairingPhone)
      }
    } catch (err) {
      logger.error({ sessionId: this.sessionId, err: err.message }, 'Connection start failed')
      await this.setStatus(STATES.ERROR, { error: err.message })
      this.scheduleReconnect()
    }
  }

  /**
   * Baileys butuh koneksi WS sebentar sebelum requestPairingCode.
   * Kalau terlalu cepat → "Connection Closed". Kalau gagal, coba lagi
   * beberapa kali (dengan jeda) sebelum benar-benar fallback ke QR —
   * request pairing code memang sering gagal di percobaan pertama.
   */
  _schedulePairingCode(sock, phone, delay = 3000) {
    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer)
      this.pairingTimer = null
    }

    const MAX_ATTEMPTS = 4

    this.pairingTimer = setTimeout(async () => {
      this.pairingTimer = null
      if (this.isStopping || !this.sock || this.sock !== sock) return
      if (sock.authState?.creds?.registered) return
      if (this.pairingCode) return // already got one

      this._pairingAttempts += 1
      try {
        const code = await sock.requestPairingCode(phone)
        if (!code || this.isStopping) return
        this._pairingRequested = true
        this.pairingCode = code
        this.pairingError = null
        this.qr = null
        await this.setStatus(STATES.PAIRING)
        logger.info(
          { sessionId: this.sessionId, attempt: this._pairingAttempts },
          'Pairing code generated'
        )
      } catch (err) {
        logger.warn(
          { sessionId: this.sessionId, attempt: this._pairingAttempts, err: err.message },
          'Pairing code request failed'
        )

        if (this.isStopping || !this.sock || this.sock !== sock) return

        if (this._pairingAttempts < MAX_ATTEMPTS) {
          // retry with a growing delay — socket might just need more time
          this._schedulePairingCode(sock, phone, 2500)
        } else {
          // benar-benar menyerah — fallback ke QR, tapi simpan alasannya
          this.pairingError = err.message
          this.pendingPairingPhone = null
          await this.setStatus(this.status, { error: `Pairing code gagal: ${err.message}` })
        }
      }
    }, delay)
  }

  _attachEvents(sock) {
    this._cleanupListeners()

    const onConnectionUpdate = (update) => {
      const { connection, lastDisconnect, qr } = update

      // QR only when not already pairing — encode off the Baileys event turn
      if (qr && !this.pairingCode) {
        this.qr = qr // raw fallback immediately
        this.setStatus(STATES.QR).catch(() => {})
        QRCode.toDataURL(qr)
          .then((dataUrl) => {
            if (this.sock === sock && !this.pairingCode) {
              this.qr = dataUrl
              this.setStatus(STATES.QR).catch(() => {})
            }
          })
          .catch(() => {})
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0
        this.qr = null
        this.pairingCode = null
        this.pendingPairingPhone = null
        this.phoneNumber = sock.user?.id?.split(':')[0] || null
        this.setStatus(STATES.CONNECTED, {
          fields: { phoneNumber: this.phoneNumber },
        }).catch(() => {})
        logger.info({ sessionId: this.sessionId, phone: this.phoneNumber }, 'Session connected')
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : lastDisconnect?.error?.output?.statusCode

        const loggedOut = statusCode === DisconnectReason.loggedOut

        if (loggedOut || this.isStopping) {
          this.setStatus(STATES.DISCONNECTED).catch(() => {})
          if (loggedOut && this.clearAuth) {
            this.clearAuth().catch(() => {})
          }
          this.sock = null
          return
        }

        this.setStatus(STATES.RECONNECTING, {
          error: serializeError(lastDisconnect?.error)?.message,
        }).catch(() => {})
        this.scheduleReconnect()
      }
    }

    const onCredsUpdate = () => {
      // Never await on the Baileys event path — authState debounces writes
      if (this.saveCreds) this.saveCreds().catch(() => {})
    }

    const onMessagesUpsert = (m) => {
      if (!this.messageHandler || this.isStopping || this.sock !== sock) return
      // Must not await — keeps Baileys event loop free for decrypt/send
      this.messageHandler.handle(this.sessionId, this.userId, sock, m).catch((err) => {
        const msg = err?.message || String(err)
        // suppress routine disconnect noise
        if (/Connection Closed|Timed Out|not-authorized/i.test(msg)) return
        logger.error({ sessionId: this.sessionId, err: msg }, 'Message handler error')
      })
    }

    sock.ev.on('connection.update', onConnectionUpdate)
    sock.ev.on('creds.update', onCredsUpdate)
    sock.ev.on('messages.upsert', onMessagesUpsert)

    this._boundHandlers = [
      ['connection.update', onConnectionUpdate],
      ['creds.update', onCredsUpdate],
      ['messages.upsert', onMessagesUpsert],
    ]
  }

  _cleanupListeners() {
    if (!this.sock) return
    for (const [event, handler] of this._boundHandlers) {
      try {
        this.sock.ev.off(event, handler)
      } catch {}
    }
    this._boundHandlers = []
  }

  scheduleReconnect() {
    if (this.isStopping || this.reconnectTimer) return

    if (this.reconnectAttempts >= config.session.reconnectMaxRetries) {
      logger.error({ sessionId: this.sessionId }, 'Max reconnect attempts reached')
      this.setStatus(STATES.ERROR, { error: 'Max reconnect attempts reached' })
      return
    }

    const delay = Math.min(
      config.session.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
      config.session.reconnectMaxDelay
    )
    this.reconnectAttempts++

    logger.info(
      { sessionId: this.sessionId, attempt: this.reconnectAttempts, delay },
      'Scheduling reconnect'
    )

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (this.isStopping) return
      this._cleanupListeners()
      if (this.pairingTimer) {
        clearTimeout(this.pairingTimer)
        this.pairingTimer = null
      }
      if (this.sock) {
        try {
          this.sock.end(undefined)
        } catch {}
        this.sock = null
      }
      // reconnect tanpa pairing ulang kecuali masih pending & belum registered
      await this.start(
        this.pendingPairingPhone ? { pairingPhone: this.pendingPairingPhone } : {}
      )
    }, delay)
  }

  async stop({ logout = false } = {}) {
    this.isStopping = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer)
      this.pairingTimer = null
    }

    this._cleanupListeners()

    if (this.sock) {
      try {
        if (logout) {
          await this.sock.logout()
          if (this.clearAuth) await this.clearAuth()
        } else {
          // Drain pending auth writes before tearing down socket
          if (this.saveCreds) await this.saveCreds({ flush: true }).catch(() => {})
          this.sock.end(undefined)
        }
      } catch (err) {
        logger.warn({ sessionId: this.sessionId, err: err.message }, 'Error while stopping socket')
      }
      this.sock = null
    }

    await this.setStatus(STATES.STOPPED)
  }

  getSocket() {
    return this.sock
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      status: this.status,
      qr: this.qr,
      pairingCode: this.pairingCode,
      pairingError: this.pairingError,
      phoneNumber: this.phoneNumber,
      reconnectAttempts: this.reconnectAttempts,
    }
  }
}

export default ConnectionManager
