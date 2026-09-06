import { BotSession } from './session.js';
import { getAllBots, getBotById, getBotsByUser } from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Multi-bot manager.
 * Each bot is fully isolated – own socket, auth, handlers, config.
 * No global shared state that can cross-contaminate bots.
 */
class BotManager {
  constructor() {
    /** @type {Map<string, BotSession>} */
    this.bots = new Map();
  }

  async bootstrap() {
    const all = await getAllBots();
    for (const record of all) {
      // Only restore bots that were connected (saved session exists).
      // Skip pairing/qr mid-flow — those need a fresh user action.
      if (record.status === 'connected' || record.status === 'connecting') {
        try {
          await this.startBot(record.id, { method: 'qr' });
        } catch (err) {
          logger.error({ botId: record.id, err: err.message }, 'Failed to restore bot');
        }
      }
    }
    logger.info({ count: this.bots.size }, 'Bot manager bootstrapped');
  }

  /**
   * @param {string} botId
   * @param {{ method?: 'qr' | 'pairing', phone?: string }} [opts]
   */
  async startBot(botId, opts = {}) {
    if (this.bots.has(botId)) {
      const existing = this.bots.get(botId);
      const active = ['connected', 'connecting', 'qr', 'pairing'].includes(existing.status);
      if (active && !opts.method) {
        return existing;
      }
      await existing.stop();
      this.bots.delete(botId);
    }

    const record = await getBotById(botId);
    if (!record) throw new Error('Bot not found');

    const session = new BotSession(record);
    this.bots.set(botId, session);
    await session.start(opts);
    return session;
  }

  async stopBot(botId) {
    const session = this.bots.get(botId);
    if (!session) return false;
    await session.stop();
    this.bots.delete(botId);
    return true;
  }

  async reconnectBot(botId) {
    await this.stopBot(botId);
    // Reconnect uses saved session (QR path). Pairing only for first link.
    return this.startBot(botId, { method: 'qr' });
  }

  getBot(botId) {
    return this.bots.get(botId) || null;
  }

  getBotForUser(botId, userId) {
    const session = this.bots.get(botId);
    if (session && session.userId === userId) return session;
    return null;
  }

  getPublicState(botId) {
    const s = this.bots.get(botId);
    if (s) return s.getPublicState();
    return null;
  }

  async getUserBotsState(userId) {
    const records = await getBotsByUser(userId);
    return records.map((r) => {
      const live = this.bots.get(r.id);
      if (live) return live.getPublicState();
      return {
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        status: r.status || 'disconnected',
        phoneNumber: r.phoneNumber,
        uptime: 0,
        qr: null,
        pairingCode: null,
        authMethod: 'qr',
        menuTitle: r.menuTitle,
        menuDescription: r.menuDescription,
        footer: r.footer,
        autoRead: r.autoRead,
        presence: r.presence,
        plugins: r.plugins || {}
      };
    });
  }
}

export const botManager = new BotManager();
export default botManager;
