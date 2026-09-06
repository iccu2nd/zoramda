import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} from '@whiskeysockets/baileys';
import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import config from '../config/index.js';
import { createBotLogger } from '../utils/logger.js';
import { updateBot } from '../db/index.js';
import { processMessage } from './messageEngine.js';
import { wrapSocket } from './socketHelpers.js';

/**
 * Isolated bot instance. No shared global socket/state.
 */
export class BotSession {
  constructor(botRecord) {
    this.id = botRecord.id;
    this.userId = botRecord.userId;
    this.name = botRecord.name;
    this.prefix = botRecord.prefix || '.';
    this.config = { ...botRecord };
    this.logger = createBotLogger(botRecord.id);
    this.sock = null;
    this.status = 'disconnected'; // disconnected | connecting | connected | qr | pairing
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.phoneNumber = botRecord.phoneNumber || null;
    this.uptimeStart = null;
    this.reconnectAttempts = 0;
    this.maxReconnect = 15;
    this.reconnectTimer = null;
    this.isIntentionallyStopped = false;
    this.eventHandlersAttached = false;
    this.authDir = path.join(config.sessionsDir, this.id);
    /** @type {'qr' | 'pairing'} */
    this.authMethod = 'qr';
    /** digits only, country code included */
    this.pairingPhone = null;
    this._pairingRequested = false;
  }

  getUptime() {
    if (!this.uptimeStart || this.status !== 'connected') return 0;
    return Math.floor((Date.now() - this.uptimeStart) / 1000);
  }

  /**
   * @param {{ method?: 'qr' | 'pairing', phone?: string }} [opts]
   */
  async start(opts = {}) {
    if (this.sock) {
      this.logger.warn('start() called while socket exists, cleaning first');
      await this._cleanupSocket();
    }
    this.isIntentionallyStopped = false;
    this.status = 'connecting';
    this.qrDataUrl = null;
    this.pairingCode = null;
    this._pairingRequested = false;

    if (opts.method === 'pairing') {
      const phone = normalizePhone(opts.phone);
      if (!phone) {
        this.status = 'disconnected';
        await this._persistStatus();
        throw new Error('Nomor wajib diisi (kode negara + nomor, hanya angka)');
      }
      this.authMethod = 'pairing';
      this.pairingPhone = phone;
    } else {
      this.authMethod = 'qr';
      this.pairingPhone = null;
    }

    await this._persistStatus();

    try {
      if (!fs.existsSync(this.authDir)) {
        fs.mkdirSync(this.authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined,
        logger: this.logger.child({ module: 'baileys' })
      });

      wrapSocket(this.sock, { botName: this.name || 'ZoraBot' });
      this._attachEvents(saveCreds);
      this.logger.info({ method: this.authMethod }, 'Socket created, connecting...');
    } catch (err) {
      this.logger.error({ err: err.message }, 'Failed to start bot');
      this.status = 'disconnected';
      await this._persistStatus();
      this._scheduleReconnect();
    }
  }

  _attachEvents(saveCreds) {
    if (!this.sock) return;
    // Prevent duplicate listeners
    this.sock.ev.removeAllListeners('connection.update');
    this.sock.ev.removeAllListeners('creds.update');
    this.sock.ev.removeAllListeners('messages.upsert');

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      try {
        await this._onConnectionUpdate(update);
      } catch (err) {
        this.logger.error({ err: err.message }, 'connection.update handler error');
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        // Fire-and-forget per message – never block the event loop chain
        setImmediate(() => {
          processMessage(this, msg).catch((err) => {
            this.logger.error({ err: err.message }, 'message processing error');
          });
        });
      }
    });

    this.eventHandlersAttached = true;
  }

  async _onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Prefer creds.me — registered flag can lag after pairing restart (515)
      const hasAccount =
        !!this.sock?.authState?.creds?.me ||
        !!this.sock?.authState?.creds?.registered;

      // Pairing: request code once when WA is ready and no account yet
      if (
        this.authMethod === 'pairing' &&
        this.pairingPhone &&
        !hasAccount &&
        !this._pairingRequested
      ) {
        this._pairingRequested = true;
        this.status = 'pairing';
        this.qrDataUrl = null;
        try {
          const code = await this.sock.requestPairingCode(this.pairingPhone);
          this.pairingCode = formatPairingCode(code);
          this.logger.info('Pairing code generated');
        } catch (err) {
          this.logger.error({ err: err.message }, 'requestPairingCode failed');
          this.pairingCode = null;
          this.status = 'disconnected';
          this._pairingRequested = false;
        }
        await this._persistStatus();
        return;
      }

      // QR flow only when not in pairing mode
      if (this.authMethod !== 'pairing') {
        this.status = 'qr';
        this.pairingCode = null;
        try {
          this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
        } catch {
          this.qrDataUrl = null;
        }
        await this._persistStatus();
        this.logger.info('QR code generated');
      }
    }

    if (connection === 'open') {
      this.status = 'connected';
      this.reconnectAttempts = 0;
      this.uptimeStart = Date.now();
      this.qrDataUrl = null;
      this.pairingCode = null;
      this.authMethod = 'qr';
      this.pairingPhone = null;
      this._pairingRequested = false;
      try {
        const me = this.sock?.user;
        if (me?.id) {
          this.phoneNumber = me.id.split(':')[0].split('@')[0];
        }
      } catch {}
      await this._persistStatus({ phoneNumber: this.phoneNumber });
      this.logger.info({ phone: this.phoneNumber }, 'Bot connected');
    }

    if (connection === 'close') {
      const statusCode = extractStatusCode(lastDisconnect);
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isRestartRequired =
        statusCode === DisconnectReason.restartRequired || statusCode === 515;

      this.logger.warn({ statusCode, isLoggedOut, isRestartRequired }, 'Connection closed');

      await this._cleanupSocket();

      if (isLoggedOut) {
        this.status = 'disconnected';
        this.uptimeStart = null;
        this.qrDataUrl = null;
        this.pairingCode = null;
        this.pairingPhone = null;
        this._pairingRequested = false;
        this.authMethod = 'qr';
        await this._persistStatus();
        this.logger.info('Logged out – clearing auth state');
        try {
          fs.rmSync(this.authDir, { recursive: true, force: true });
        } catch {}
        this.isIntentionallyStopped = true;
        return;
      }

      // 515 after pairing/QR success: WA asks for immediate reconnect with saved creds
      if (isRestartRequired && !this.isIntentionallyStopped) {
        this.logger.info('Restart required (515) – reconnecting with saved session');
        this.status = 'connecting';
        this.qrDataUrl = null;
        this.pairingCode = null;
        // Switch off pairing mode so we do NOT request a new code
        this.authMethod = 'qr';
        this.pairingPhone = null;
        this._pairingRequested = false;
        await this._persistStatus();
        // Brief pause so multi-file auth state finishes writing to disk
        this._scheduleReconnect({ immediate: true, delayMs: 1200 });
        return;
      }

      // Still waiting for user to enter pairing code on phone — keep UI, no reconnect loop
      if (
        this.authMethod === 'pairing' &&
        this.pairingCode &&
        !this.isIntentionallyStopped
      ) {
        this.status = 'pairing';
        this.uptimeStart = null;
        this.qrDataUrl = null;
        await this._persistStatus();
        this.logger.info('Waiting for pairing code entry on phone');
        return;
      }

      this.status = 'disconnected';
      this.uptimeStart = null;
      this.qrDataUrl = null;
      this.pairingCode = null;
      await this._persistStatus();

      if (!this.isIntentionallyStopped) {
        this._scheduleReconnect();
      }
    }
  }

  /**
   * @param {{ immediate?: boolean, delayMs?: number }} [opts]
   */
  _scheduleReconnect(opts = {}) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconnectAttempts >= this.maxReconnect) {
      this.logger.error('Max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts += 1;

    let delay;
    if (opts.immediate) {
      delay = opts.delayMs ?? 1000;
    } else {
      delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 60_000);
    }

    this.logger.info({ attempt: this.reconnectAttempts, delay }, 'Scheduling reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isIntentionallyStopped) {
        // Always resume with saved session (QR path). Pairing only for first link.
        this.start({ method: 'qr' }).catch((err) => {
          this.logger.error({ err: err.message }, 'Reconnect failed');
        });
      }
    }, delay);
  }

  async stop() {
    this.isIntentionallyStopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this._cleanupSocket();
    this.status = 'disconnected';
    this.uptimeStart = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.pairingPhone = null;
    this._pairingRequested = false;
    this.authMethod = 'qr';
    await this._persistStatus();
    this.logger.info('Bot stopped');
  }

  async _cleanupSocket() {
    if (!this.sock) return;
    try {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      this.sock.end(undefined);
    } catch (err) {
      this.logger.warn({ err: err.message }, 'Error during socket cleanup');
    }
    this.sock = null;
    this.eventHandlersAttached = false;
  }

  async _persistStatus(extra = {}) {
    try {
      await updateBot(this.id, this.userId, {
        status: this.status,
        phoneNumber: this.phoneNumber,
        ...extra
      });
    } catch (err) {
      this.logger.error({ err: err.message }, 'Failed to persist status');
    }
  }

  async updateConfig(patch) {
    Object.assign(this.config, patch);
    if (patch.name) this.name = patch.name;
    if (patch.prefix !== undefined) this.prefix = patch.prefix;
    await updateBot(this.id, this.userId, patch);
  }

  getPublicState() {
    return {
      id: this.id,
      name: this.name,
      prefix: this.prefix,
      status: this.status,
      phoneNumber: this.phoneNumber,
      uptime: this.getUptime(),
      qr: this.qrDataUrl,
      pairingCode: this.pairingCode,
      authMethod: this.authMethod,
      menuTitle: this.config.menuTitle,
      menuDescription: this.config.menuDescription,
      footer: this.config.footer,
      autoRead: this.config.autoRead,
      presence: this.config.presence,
      plugins: this.config.plugins || {}
    };
  }
}

/** Keep digits only (country code + number). */
function normalizePhone(input) {
  if (!input || typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** Format 8-char code as XXXX-XXXX for readability. */
function formatPairingCode(code) {
  if (!code) return null;
  const clean = String(code).replace(/\s|-/g, '').toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

/**
 * Unwrap Baileys lastDisconnect status code from nested Boom / wrapper shapes.
 */
function extractStatusCode(lastDisconnect) {
  const err = lastDisconnect?.error;
  if (!err) return 0;

  if (err.output?.statusCode != null) return Number(err.output.statusCode);
  if (err.statusCode != null) return Number(err.statusCode);
  if (err.error?.output?.statusCode != null) return Number(err.error.output.statusCode);
  if (err.data?.attrs?.code != null) return Number(err.data.attrs.code);
  if (typeof err === 'object' && err.status != null) return Number(err.status);
  return 0;
}
