import { BotInstance } from './bot-instance.js';
import { logger } from '../utils/logger.js';

/**
 * The only place bot instances live. A Map keyed by bot id — deliberately
 * NOT a single shared socket or shared mutable "current bot" variable, so
 * that one bot's crash, reconnect loop, or plugin error can never bleed
 * into another bot's request handling.
 */
class BotManager {
  constructor() {
    /** @type {Map<string, BotInstance>} */
    this.instances = new Map();
  }

  get(botId) {
    return this.instances.get(botId) || null;
  }

  getOrCreate(botId) {
    let instance = this.instances.get(botId);
    if (!instance) {
      instance = new BotInstance(botId);
      this.instances.set(botId, instance);
    }
    return instance;
  }

  async connect(botId, opts) {
    const instance = this.getOrCreate(botId);
    await instance.connect(opts);
    return instance;
  }

  async disconnect(botId) {
    const instance = this.instances.get(botId);
    if (instance) await instance.disconnect();
  }

  async reconnect(botId) {
    const instance = this.getOrCreate(botId);
    await instance.reconnect();
    return instance;
  }

  async remove(botId) {
    const instance = this.instances.get(botId);
    if (instance) {
      await instance.disconnect().catch(() => {});
      instance.destroy();
      this.instances.delete(botId);
    }
  }

  async shutdownAll() {
    logger.info({ count: this.instances.size }, 'shutting down all bot instances');
    for (const instance of this.instances.values()) {
      instance.shouldReconnect = false;
      instance.destroy();
    }
    this.instances.clear();
  }
}

export const botManager = new BotManager();
