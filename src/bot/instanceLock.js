import crypto from 'node:crypto';
import { getLocksCollection } from '../db/mongo.js';
import logger from '../utils/logger.js';

// One id per running process — stable for the process lifetime.
export const INSTANCE_ID = crypto.randomUUID();

const LOCK_TTL_MS = 45_000;

/**
 * Try to become (or remain) the sole owner of a bot's live WhatsApp socket.
 *
 * Needed because Railway's rolling deploys briefly run the old container
 * alongside the new one. If both connect the same stored session at once,
 * WhatsApp treats it as a conflicting device and force-logs it out (401),
 * wiping the session. Only the instance holding this lock is allowed to
 * open a socket for the bot; everyone else waits for the lock to free up.
 *
 * @param {string} botId
 * @returns {Promise<boolean>} true if this instance now holds the lock
 */
export async function acquireBotLock(botId) {
  const col = await getLocksCollection();
  const now = new Date();
  try {
    await col.findOneAndUpdate(
      { botId, $or: [{ expiresAt: { $lt: now } }, { instanceId: INSTANCE_ID }] },
      { $set: { botId, instanceId: INSTANCE_ID, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    // Duplicate key on { botId } means some other, still-fresh instance holds it.
    if (err?.code === 11000) return false;
    logger.error({ err: err.message, botId }, 'Bot lock acquire error');
    return false;
  }
}

export const renewBotLock = acquireBotLock;

export async function releaseBotLock(botId) {
  const col = await getLocksCollection();
  try {
    await col.deleteOne({ botId, instanceId: INSTANCE_ID });
  } catch (err) {
    logger.warn({ err: err.message, botId }, 'Bot lock release failed');
  }
}
