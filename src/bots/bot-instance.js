import { EventEmitter } from 'node:events';
import baileysPkg from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { botLogger } from '../utils/logger.js';
import { sessionDirFor } from './session-store.js';
import { botsRepo } from '../db/repo.js';
import { handleIncomingMessages } from '../engine/message-engine.js';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} = baileysPkg;

const MAX_RECONNECT_DELAY_MS = 60_000;
const BASE_RECONNECT_DELAY_MS = 2_000;

/**
 * One fully isolated WhatsApp connection. Each BotInstance owns its socket,
 * its own event handlers, its own reconnect timer, and its own group
 * metadata cache. Nothing here is shared with other bots (no module-level
 * socket, no shared state map) — the BotManager holds one of these per bot
 * and that is the entire blast radius of any failure inside it.
 */
export class BotInstance extends EventEmitter {
  constructor(botId) {
    super();
    this.id = botId;
    this.log = botLogger(botId);
    this.sock = null;
    this.status = 'disconnected'; // disconnected | connecting | connected
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.connectedAt = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.shouldReconnect = true;
    this.destroyed = false;

    /** Group metadata cache: jid -> { data, fetchedAt }. Per-bot, so one
     * bot's cache churn never affects another bot's lookups. */
    this.groupMetaCache = new Map();
  }

  setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  async connect({ pairingPhoneNumber } = {}) {
    if (this.destroyed) throw new Error('Bot instance has been destroyed');
    if (this.status === 'connecting' || this.status === 'connected') return;

    this.setStatus('connecting');
    this.qrDataUrl = null;
    this.pairingCode = null;

    const { state, saveCreds } = await useMultiFileAuthState(sessionDirFor(this.id));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.macOS('ZoraBot'),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          this.qrDataUrl = await QRCode.toDataURL(qr);
          this.emit('qr', this.qrDataUrl);
        } catch (err) {
          this.log.error({ err: err.message }, 'failed to render QR');
        }
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0;
        this.qrDataUrl = null;
        this.pairingCode = null;
        this.connectedAt = Date.now();
        const phoneNumber = sock.user?.id?.split(':')[0] || null;
        botsRepo.updateStatus(this.id, 'connected', { phoneNumber, connectedAt: this.connectedAt });
        this.setStatus('connected');
        this.log.info({ phoneNumber }, 'bot connected');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        this.connectedAt = null;
        this._cleanupSocket();

        if (loggedOut) {
          this.log.warn('session logged out; will not auto-reconnect');
          botsRepo.updateStatus(this.id, 'disconnected');
          this.setStatus('disconnected');
          this.shouldReconnect = false;
          return;
        }

        botsRepo.updateStatus(this.id, 'disconnected');
        this.setStatus('disconnected');

        if (this.shouldReconnect && !this.destroyed) {
          this._scheduleReconnect();
        }
      }
    });

    sock.ev.on('messages.upsert', (payload) => {
      // Fire-and-forget: never await this inside the event handler, or one
      // slow/heavy message would delay Baileys from processing the next
      // event (including its own keep-alive/connection traffic).
      handleIncomingMessages(this, payload).catch((err) => {
        this.log.error({ err: err.message }, 'message engine failed');
      });
    });

    if (pairingPhoneNumber && !state.creds.registered) {
      try {
        const code = await sock.requestPairingCode(pairingPhoneNumber.replace(/[^0-9]/g, ''));
        this.pairingCode = code;
        this.emit('pairing-code', code);
      } catch (err) {
        this.log.error({ err: err.message }, 'failed to request pairing code');
      }
    }
  }

  _scheduleReconnect() {
    this.reconnectAttempts += 1;
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS);
    this.log.info({ attempt: this.reconnectAttempts, delayMs: delay }, 'scheduling reconnect');
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed && this.shouldReconnect) this.connect().catch((err) => this.log.error({ err: err.message }, 'reconnect failed'));
    }, delay);
  }

  _cleanupSocket() {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
      } catch { /* noop */ }
      this.sock = null;
    }
  }

  async disconnect() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        try { this.sock.end(undefined); } catch { /* noop */ }
      }
    }
    this._cleanupSocket();
    this.connectedAt = null;
    botsRepo.updateStatus(this.id, 'disconnected');
    this.setStatus('disconnected');
  }

  /** Reconnect without logging out (keeps existing credentials). */
  async reconnect() {
    clearTimeout(this.reconnectTimer);
    this.shouldReconnect = true;
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* noop */ }
      this._cleanupSocket();
    }
    this.reconnectAttempts = 0;
    await this.connect();
  }

  destroy() {
    this.destroyed = true;
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    this._cleanupSocket();
    this.groupMetaCache.clear();
    this.removeAllListeners();
  }

  getUptimeMs() {
    return this.connectedAt ? Date.now() - this.connectedAt : 0;
  }

  async getGroupMetadata(jid) {
    const cached = this.groupMetaCache.get(jid);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 5 * 60_000) return cached.data;
    if (!this.sock) return null;
    const data = await this.sock.groupMetadata(jid);
    this.groupMetaCache.set(jid, { data, fetchedAt: now });
    return data;
  }
}
