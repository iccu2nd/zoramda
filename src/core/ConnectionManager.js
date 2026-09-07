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
import { serializeError } from '../utils/helpers.js'

const baileysLogger = pino({ level: 'silent' })

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
  constructor(sessionId, { messageHandler, onStatusChange } = {}) {
    this.sessionId = sessionId
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
    try {
      await Session.findOneAndUpdate(
        { sessionId: this.sessionId },
        {
          status,
          qr: this.qr,
          pairingCode: this.pairingCode,
          phoneNumber: this.phoneNumber,
          lastError: extra.error || null,
          ...extra.fields,
        }
      )
    } catch (err) {
      logger.error({ sessionId: this.sessionId, err: err.message }, 'Failed to update session status')
    }
    this.onStatusChange(this.sessionId, status, extra)
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

      const { state, saveCreds, clearAuth } = await useMongoAuthState(this.sessionId)
      this.saveCreds = saveCreds
      this.clearAuth = clearAuth

      const { version } = await fetchLatestBaileysVersion()

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
      })

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

    const onConnectionUpdate = async (update) => {
      const { connection, lastDisconnect, qr } = update

      // QR hanya jika belum pakai pairing code
      if (qr && !this.pairingCode) {
        try {
          this.qr = await QRCode.toDataURL(qr)
        } catch {
          this.qr = qr
        }
        await this.setStatus(STATES.QR)
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0
        this.qr = null
        this.pairingCode = null
        this.pendingPairingPhone = null
        this.phoneNumber = sock.user?.id?.split(':')[0] || null
        await this.setStatus(STATES.CONNECTED, {
          fields: { phoneNumber: this.phoneNumber },
        })
        logger.info({ sessionId: this.sessionId, phone: this.phoneNumber }, 'Session connected')
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : lastDisconnect?.error?.output?.statusCode

        const loggedOut = statusCode === DisconnectReason.loggedOut

        if (loggedOut || this.isStopping) {
          await this.setStatus(STATES.DISCONNECTED)
          if (loggedOut && this.clearAuth) {
            await this.clearAuth()
          }
          this.sock = null
          return
        }

        await this.setStatus(STATES.RECONNECTING, {
          error: serializeError(lastDisconnect?.error)?.message,
        })
        this.scheduleReconnect()
      }
    }

    const onCredsUpdate = async () => {
      if (this.saveCreds) await this.saveCreds()
    }

    const onMessagesUpsert = async (m) => {
      if (!this.messageHandler) return
      this.messageHandler.handle(this.sessionId, sock, m).catch((err) => {
        logger.error({ sessionId: this.sessionId, err: err.message }, 'Message handler error')
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
