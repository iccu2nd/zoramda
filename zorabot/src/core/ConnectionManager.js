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
  /**
   * @param {string} sessionId
   * @param {object} opts
   * @param {import('./MessageHandler.js').MessageHandler} opts.messageHandler
   * @param {Function} opts.onStatusChange
   */
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
    this.isStopping = false
    this.phoneNumber = null
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
        getMessage: async () => undefined, // minimal – no full store needed for gateway
      })

      this.sock = sock
      this._attachEvents(sock)

      // Pairing code flow
      if (pairingPhone && !state.creds.registered) {
        try {
          const code = await sock.requestPairingCode(pairingPhone.replace(/\D/g, ''))
          this.pairingCode = code
          await this.setStatus(STATES.PAIRING)
          logger.info({ sessionId: this.sessionId }, 'Pairing code generated')
        } catch (err) {
          logger.error({ sessionId: this.sessionId, err: err.message }, 'Pairing code failed')
          await this.setStatus(STATES.ERROR, { error: err.message })
        }
      }
    } catch (err) {
      logger.error({ sessionId: this.sessionId, err: err.message }, 'Connection start failed')
      await this.setStatus(STATES.ERROR, { error: err.message })
      this.scheduleReconnect()
    }
  }

  _attachEvents(sock) {
    // Remove any previous listeners if re-created
    this._cleanupListeners()

    const onConnectionUpdate = async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        try {
          this.qr = await QRCode.toDataURL(qr)
        } catch {
          this.qr = qr // fallback raw
        }
        await this.setStatus(STATES.QR)
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0
        this.qr = null
        this.pairingCode = null
        this.phoneNumber = sock.user?.id?.split(':')[0] || null
        await this.setStatus(STATES.CONNECTED, {
          fields: { phoneNumber: this.phoneNumber },
        })
        logger.info({ sessionId: this.sessionId, phone: this.phoneNumber }, 'Session connected')
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error instanceof Boom
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

        // Reconnect with backoff
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
      // Fire-and-forget – never block Baileys event loop
      this.messageHandler
        .handle(this.sessionId, sock, m)
        .catch((err) => {
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
      // Clean old socket
      this._cleanupListeners()
      if (this.sock) {
        try {
          this.sock.end(undefined)
        } catch {}
        this.sock = null
      }
      await this.start()
    }, delay)
  }

  async stop({ logout = false } = {}) {
    this.isStopping = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
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
      phoneNumber: this.phoneNumber,
      reconnectAttempts: this.reconnectAttempts,
    }
  }
}

export default ConnectionManager
