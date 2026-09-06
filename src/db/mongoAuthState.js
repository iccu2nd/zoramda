import { proto } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { getAuthCollection } from './mongo.js';

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

  const writeData = async (data, dataId) => {
    const value = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    await collection.updateOne(
      { sessionId, dataId },
      { $set: { sessionId, dataId, value } },
      { upsert: true }
    );
  };

  const readData = async (dataId) => {
    const doc = await collection.findOne({ sessionId, dataId });
    if (!doc?.value) return null;
    return JSON.parse(JSON.stringify(doc.value), BufferJSON.reviver);
  };

  const removeData = async (dataId) => {
    await collection.deleteOne({ sessionId, dataId });
  };

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
 * Equivalent to deleting the old sessions/<botId> folder.
 */
export async function clearMongoAuthState(sessionId) {
  const collection = await getAuthCollection();
  await collection.deleteMany({ sessionId });
}
