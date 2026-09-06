import { proto } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { getAuthCollection } from './mongo.js';
import logger from '../utils/logger.js';

/**
 * Every Mongo op for a given bot/session is funneled through this queue so
 * they always run strictly in the order they were called — across reconnects
 * too, since the queue lives at module scope keyed by sessionId, not inside
 * a single useMongoAuthState() closure.
 *
 * Without this, a `creds.update` write from just before a 515/restart could
 * still be in flight when the new socket immediately re-reads "creds" from
 * Mongo, handing Baileys a stale/incomplete snapshot — which WhatsApp then
 * rejects with a 401 right after connecting, wiping the session and looping
 * forever. Serializing read-after-write per session fixes that.
 */
const queues = new Map();

function runQueued(sessionId, task) {
  const prev = queues.get(sessionId) || Promise.resolve();
  const next = prev.then(task, task);
  // keep the chain alive even if a step fails, without leaking unhandled rejections
  queues.set(sessionId, next.catch(() => {}));
  return next;
}

/**
 * Drop-in MongoDB replacement for Baileys' useMultiFileAuthState.
 * Stores creds + every signal key category as documents keyed by
 * { sessionId, dataId }, so each bot's session lives in MongoDB instead
 * of the local filesystem.
 *
 * @param {string} sessionId usually the bot's id
 */
export async function useMongoAuthState(sessionId) {
  const collection = await getAuthCollection();

  const writeData = (data, dataId) =>
    runQueued(sessionId, async () => {
      const value = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await collection.updateOne(
        { sessionId, dataId },
        { $set: { sessionId, dataId, value } },
        { upsert: true }
      );
    }).catch((err) => {
      logger.error({ err: err.message, sessionId, dataId }, 'Mongo auth-state write failed');
    });

  const readData = (dataId) =>
    runQueued(sessionId, async () => {
      const doc = await collection.findOne({ sessionId, dataId });
      if (!doc?.value) return null;
      return JSON.parse(JSON.stringify(doc.value), BufferJSON.reviver);
    });

  const removeData = (dataId) =>
    runQueued(sessionId, async () => {
      await collection.deleteOne({ sessionId, dataId });
    }).catch((err) => {
      logger.error({ err: err.message, sessionId, dataId }, 'Mongo auth-state remove failed');
    });

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const dataId = `${category}-${id}`;
              tasks.push(value ? writeData(value, dataId) : removeData(dataId));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds')
  };
}

/**
 * Wipe a bot's stored auth state (creds + all signal keys) from MongoDB.
 * Equivalent to deleting the old sessions/<botId> folder. Queued too, so it
 * can't jump ahead of a write that's still in flight for the same bot.
 */
export async function clearMongoAuthState(sessionId) {
  const collection = await getAuthCollection();
  await runQueued(sessionId, async () => {
    await collection.deleteMany({ sessionId });
  });
}
