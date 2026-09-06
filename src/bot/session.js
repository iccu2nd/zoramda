import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import config from '../config/index.js';
import { createBotLogger } from '../utils/logger.js';
import { updateBot } from '../db/index.js';
import { useMongoAuthState, clearMongoAuthState } from '../db/mongoAuthState.js';
import { processMessage } from './messageEngine.js';
import { wrapSocket } from './socketHelpers.js';

/**
 * Isolated bot instance.
 * Pairing flow aligned with working ZoraBot reference:
 * - clear session only on NEW pairing/QR (not on 515 restart)
 * - creds.update before requestPairingCode
 * - requestPairingCode only when !isRestart
 * - on close != loggedOut → restart with isRestart:true, keep session
 * - keep pairingCode during 515 restarts
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
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.phoneNumber = botRecord.phoneNumber || null;
    this.uptimeStart = null;
    this.reconnectAttempts = 0;
    this.maxReconnect = 20;
    this.reconnectTimer = null;
    this.isIntentionallyStopped = false;
    this.eventHandlersAttached = false;

    /** @type {'qr' | 'pairing'} */
    this.authMethod = 'qr';
    this.pairingPhone = null;

    this._starting = false;
    this._gen = 0;
    this._pairingRestarts = 0;
    this._qrRestarts = 0;
    this._saveCreds = null;
  }

  getUptime() {
    if (!this.uptimeStart || this.status !== 'connected') return 0;
    return Math.floor((Date.now() - this.uptimeStart) / 1000);
  }

  /**
   * @param {{
   *   method?: 'qr' | 'pairing',
   *   phone?: string,
   *   isRestart?: boolean,
   *   clearSessionFirst?: boolean
   * }} [opts]
   */
  async start(opts = {}) {
    if (this._starting) return;
    this._starting = true;
    const gen = ++this._gen;

    const {
      method,
      phone,
      isRestart = false,
      clearSessionFirst = false
    } = opts;

    try {
      this.isIntentionallyStopped = false;

      if (method === 'pairing') {
        const normalized = normalizePhone(phone);
        if (!normalized && !isRestart) {
          this.status = 'disconnected';
          await this._persistStatus();
          throw new Error('Nomor wajib diisi (kode negara + nomor, hanya angka)');
        }
        if (normalized) this.pairingPhone = normalized;
        this.authMethod = 'pairing';
      } else if (method === 'qr') {
        this.authMethod = 'qr';
        if (!isRestart) this.pairingPhone = null;
      }

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      await this._cleanupSocket();
      if (gen !== this._gen) return;

      // NEW pairing/QR only: wipe session. 515 restart must KEEP session.
      const forceNewAuth =
        !isRestart && (this.authMethod === 'pairing' || clearSessionFirst || method === 'qr');

      if (forceNewAuth && this.authMethod === 'pairing') {
        await this._clearAuthDir();
        if (!isRestart) {
          this.pairingCode = null;
          this._pairingRestarts = 0;
          this._qrRestarts = 0;
        }
        this.logger.info('Session cleared for new pairing');
      } else if (!isRestart && method === 'qr' && clearSessionFirst) {
        await this._clearAuthDir();
        this.pairingCode = null;
        this._qrRestarts = 0;
      }

      if (!isRestart) {
        this.qrDataUrl = null;
      }

      // Keep pairing UI while restarting after 515
      if (this.pairingCode && isRestart) {
        this.status = 'pairing';
      } else {
        this.status = 'connecting';
      }
      await this._persistStatus();

      const { state, saveCreds } = await useMongoAuthState(this.id);
      this._saveCreds = saveCreds;
      const { version } = await fetchLatestBaileysVersion();

      // Canonical browser tuple — important for pairing code acceptance
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        getMessage: async () => undefined,
        logger: this.logger.child({ module: 'baileys' })
      });

      if (gen !== this._gen || this.isIntentionallyStopped) {
        try {
          sock.end?.(undefined);
        } catch {}
        return;
      }

      this.sock = sock;
      wrapSocket(this.sock, { botName: this.name || 'ZoraBot' });

      // creds.update MUST be registered before requestPairingCode
      this._attachEvents(saveCreds);

      this.logger.info(
        { method: this.authMethod, isRestart, registered: !!sock.authState?.creds?.registered },
        'Socket created'
      );

      // Pairing code only on manual connect — never on 515 restart
      const needPairing =
        !isRestart &&
        this.authMethod === 'pairing' &&
        this.pairingPhone &&
        !sock.authState.creds.registered;

      if (needPairing) {
        this.status = 'pairing';
        await this._persistStatus();
        try {
          await sleep(500);
          if (gen !== this._gen || this.isIntentionallyStopped || !this.sock) return;

          const code = await this.sock.requestPairingCode(this.pairingPhone);
          this.pairingCode = formatPairingCode(code);
          this._pairingRestarts = 0;
          this.status = 'pairing';
          await this._persistStatus();
          this.logger.info({ code: this.pairingCode }, 'Pairing code generated');
        } catch (err) {
          this.logger.error({ err: err.message }, 'requestPairingCode failed');
          this.pairingCode = null;
          this.status = 'disconnected';
          await this._persistStatus();
        }
      } else if (sock.authState.creds.registered) {
        this.status = 'connecting';
        this.logger.info('Saved session found, waiting for open...');
      }
    } catch (err) {
      this.logger.error({ err: err.message }, 'Failed to start bot');
      this.status = 'disconnected';
      await this._persistStatus();
      if (!this.isIntentionallyStopped) {
        this._scheduleReconnect({ isRestart: true });
      }
    } finally {
      this._starting = false;
    }
  }

  _attachEvents(saveCreds) {
    if (!this.sock) return;

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
    const sock = this.sock;

    // QR display (only when not using pairing code flow)
    if (qr && this.authMethod !== 'pairing') {
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

    if (connection === 'open') {
      this.status = 'connected';
      this.reconnectAttempts = 0;
      this._pairingRestarts = 0;
      this._qrRestarts = 0;
      this.uptimeStart = Date.now();
      this.qrDataUrl = null;
      this.pairingCode = null;
      this.authMethod = 'qr';
      this.pairingPhone = null;
      try {
        const me = sock?.user;
        if (me?.id) {
          this.phoneNumber = me.id.split(':')[0].split('@')[0];
        }
      } catch {}
      await this._persistStatus({ phoneNumber: this.phoneNumber });
      this.logger.info({ phone: this.phoneNumber }, 'Bot connected');
      return;
    }

    if (connection === 'close') {
      const statusCode = extractStatusCode(lastDisconnect);
      const errMsg = lastDisconnect?.error?.message || 'Connection Closed';
      const wasRegistered = !!sock?.authState?.creds?.registered;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      this.logger.warn(
        { statusCode, isLoggedOut, wasRegistered, errMsg },
        'Connection closed'
      );

      // Detach socket reference (same as reference)
      this.sock = null;
      this.eventHandlersAttached = false;

      if (this.isIntentionallyStopped) return;

      // Only real logout clears session
      if (isLoggedOut) {
        // If we never completed open and still had pairing in progress,
        // a 401 can appear after a broken handshake — still clear to avoid poison state.
        this.logger.info('Logged out – clearing auth state');
        await this._clearAuthDir();
        this.status = 'disconnected';
        this.uptimeStart = null;
        this.qrDataUrl = null;
        this.pairingCode = null;
        this.pairingPhone = null;
        this.authMethod = 'qr';
        this._pairingRestarts = 0;
        this._qrRestarts = 0;
        await this._persistStatus();
        return;
      }

      // 515 / other closes → restart WITH session (do NOT clear pairingCode yet)
      if (this.pairingCode && !wasRegistered) {
        this._pairingRestarts += 1;
        if (this._pairingRestarts > 2) {
          this.logger.warn(
            { restarts: this._pairingRestarts },
            'Pairing code expired (reconnects without registered)'
          );
          this.pairingCode = null;
          this.status = 'disconnected';
          this.authMethod = 'qr';
          this.pairingPhone = null;
          this._pairingRestarts = 0;
          await this._persistStatus();
          return;
        }
        this.status = 'pairing';
        this.logger.info(
          { attempt: this._pairingRestarts },
          '515/close during pairing – restart keeping session & code'
        );
      } else if (this.pairingCode) {
        this.status = 'pairing';
      } else if (!wasRegistered) {
        this._qrRestarts += 1;
        if (this._qrRestarts > 6) {
          this.logger.warn('QR expired without scan – stop auto-restart');
          this.qrDataUrl = null;
          this.status = 'disconnected';
          this._qrRestarts = 0;
          await this._persistStatus();
          return;
        }
        this.status = 'connecting';
      } else {
        this._qrRestarts = 0;
        this.status = 'connecting';
      }

      this.uptimeStart = null;
      await this._persistStatus();

      // Always restart with isRestart:true → session preserved, no new pairing request
      this._scheduleReconnect({ isRestart: true, delayMs: 1500 });
    }
  }

  /**
   * @param {{ isRestart?: boolean, delayMs?: number }} [opts]
   */
  _scheduleReconnect(opts = {}) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.isIntentionallyStopped) return;

    if (this.reconnectAttempts >= this.maxReconnect) {
      this.logger.error('Max reconnect attempts reached');
      this.status = 'disconnected';
      this._persistStatus().catch(() => {});
      return;
    }

    this.reconnectAttempts += 1;
    const delay = opts.delayMs ?? Math.min(1000 * Math.pow(1.4, this.reconnectAttempts), 30_000);
    const isRestart = opts.isRestart !== false;

    this.logger.info({ attempt: this.reconnectAttempts, delay, isRestart }, 'Scheduling reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isIntentionallyStopped) return;
      this.start({
        isRestart,
        method: this.authMethod === 'pairing' && this.pairingCode ? 'pairing' : 'qr',
        phone: this.pairingPhone || undefined
      }).catch((err) => {
        this.logger.error({ err: err.message }, 'Reconnect failed');
      });
    }, delay);
  }

  async stop() {
    this.isIntentionallyStopped = true;
    this._gen += 1;
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
    this.authMethod = 'qr';
    this._pairingRestarts = 0;
    this._qrRestarts = 0;
    await this._persistStatus();
    this.logger.info('Bot stopped');
  }

  async _cleanupSocket() {
    if (!this.sock) return;
    try {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      this.sock.end?.(undefined);
    } catch (err) {
      this.logger.warn({ err: err.message }, 'Error during socket cleanup');
    }
    this.sock = null;
    this.eventHandlersAttached = false;
  }

  async _clearAuthDir() {
    try {
      await clearMongoAuthState(this.id);
    } catch (err) {
      this.logger.warn({ err: err.message }, 'Failed to clear Mongo auth state');
    }
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

function normalizePhone(input) {
  if (!input || typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function formatPairingCode(code) {
  if (!code) return null;
  const clean = String(code).replace(/\s|-/g, '').toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
